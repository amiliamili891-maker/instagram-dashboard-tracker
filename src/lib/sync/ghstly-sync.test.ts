/**
 * Tests for Ghstly Sync Service
 *
 * Covers:
 *   - Field mapping transformation (sessions UTM -> canonical join keys)
 *   - Joinability classification (joinable, unjoinable with link_in_bio, null campaign_id, empty creative)
 *   - PII stripping (ip_address and user_agent removed)
 *   - Daily stats transformation
 *   - Idempotency (same sync twice yields same rows)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GhstlySession, GhstlyStatsDailyRow } from '@/lib/contracts/data-contract';
import {
  transformSession,
  transformDailyStatsRow,
  syncGhstlyIncremental,
  syncGhstlyBackfill,
} from './ghstly-sync';
import type { SessionRow, DailyGhstlyStatsRow, GhstlyPersistence } from './ghstly-sync';
import type { GhstlyClient } from '@/lib/api/ghstly-client';

// ---------------------------------------------------------------------------
// Fixture data (from src/test/fixtures/)
// ---------------------------------------------------------------------------

import ghstlyStats from '@/test/fixtures/ghstly-stats.json';
import ghstlyStatsDaily from '@/test/fixtures/ghstly-stats-daily.json';
import ghstlySessions from '@/test/fixtures/ghstly-sessions.json';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_BATCH_ID = '00000000-0000-0000-0000-000000000001';

function makeSession(overrides: Partial<GhstlySession> = {}): GhstlySession {
  return {
    session_id: 'test-session-001',
    created_at: '2026-03-21T02:23:29.337394-07:00',
    started_at: '2026-03-21T02:23:29.337391-07:00',
    ended_at: null,
    status: 'active',
    messages_count: 17,
    brand: 'Ghstly',
    reached_reveal: false,
    clicked_through: false,
    converted: false,
    campaign: '120244144794240528',
    creative: '120244145635450528',
    keyword: '120244145635460528',
    city: 'Covington',
    region: 'Georgia',
    country: 'US',
    ...overrides,
  };
}

function makeMockPersistence(): GhstlyPersistence {
  return {
    upsertDailyGhstlyStats: vi.fn().mockResolvedValue(undefined),
    upsertSessions: vi.fn().mockResolvedValue(undefined),
    insertSyncLog: vi.fn().mockResolvedValue(undefined),
  };
}

function makeMockClient(overrides: Partial<GhstlyClient> = {}): GhstlyClient {
  return {
    fetchStats: vi.fn().mockResolvedValue(ghstlyStats),
    fetchStatsDaily: vi.fn().mockResolvedValue(ghstlyStatsDaily),
    fetchSessions: vi.fn().mockResolvedValue({
      ...ghstlySessions,
      total: ghstlySessions.items.length, // ensure pagination stops
    }),
    fetchSessionMessages: vi.fn().mockResolvedValue({ items: [] }),
    ...overrides,
  } as unknown as GhstlyClient;
}

// ---------------------------------------------------------------------------
// Tests: Field Mapping Transformation
// ---------------------------------------------------------------------------

describe('transformSession — field mapping', () => {
  it('maps session.campaign to campaign_id', () => {
    const session = makeSession({ campaign: '120244144794240528' });
    const row = transformSession(session, TEST_BATCH_ID);
    expect(row.campaign_id).toBe('120244144794240528');
  });

  it('maps session.keyword to adset_id', () => {
    const session = makeSession({ keyword: '120244145635460528' });
    const row = transformSession(session, TEST_BATCH_ID);
    expect(row.adset_id).toBe('120244145635460528');
  });

  it('maps session.creative to ad_id', () => {
    const session = makeSession({ creative: '120244145635450528' });
    const row = transformSession(session, TEST_BATCH_ID);
    expect(row.ad_id).toBe('120244145635450528');
  });

  it('ignores session.ad_id field (always empty in live data)', () => {
    const session = makeSession({ ad_id: '' });
    const row = transformSession(session, TEST_BATCH_ID);
    // The row.ad_id should come from session.creative, NOT session.ad_id
    expect(row.ad_id).toBe(session.creative);
    // Verify ad_id from session (the empty string) does not appear as the join key
    expect(row.ad_id).not.toBe('');
  });

  it('maps all fixture sessions correctly', () => {
    const sessions = ghstlySessions.items as GhstlySession[];
    for (const session of sessions) {
      const row = transformSession(session, TEST_BATCH_ID);
      expect(row.campaign_id).toBe(session.campaign);
      expect(row.adset_id).toBe(session.keyword);
      expect(row.ad_id).toBe(session.creative);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: Joinability Classification
// ---------------------------------------------------------------------------

describe('transformSession — joinability classification', () => {
  it('classifies a normal Meta session as joinable', () => {
    const session = makeSession({
      source: 'meta',
      campaign: '120244144794240528',
      keyword: '120244145635460528',
      creative: '120244145635450528',
    });
    const row = transformSession(session, TEST_BATCH_ID);
    expect(row.join_status).toBe('joinable');
    expect(row.join_issue).toBeNull();
  });

  it('classifies session with empty source as unjoinable (non-meta source)', () => {
    const session = makeSession({
      source: '',
      campaign: '',
      keyword: '',
      creative: '',
    });
    const row = transformSession(session, TEST_BATCH_ID);
    expect(row.join_status).toBe('unjoinable');
    expect(row.join_issue).toContain('non-meta source');
  });

  it('classifies session with null campaign_id as unjoinable', () => {
    // Sessions with empty campaign string become empty string ad_id in canonical form
    const session = makeSession({
      source: 'meta',
      campaign: '',
      keyword: '120244145635460528',
      creative: '120244145635450528',
    });
    const row = transformSession(session, TEST_BATCH_ID);
    expect(row.join_status).toBe('unjoinable');
    expect(row.join_issue).toContain('campaign_id');
  });

  it('classifies session with empty creative as unjoinable', () => {
    const session = makeSession({
      source: 'meta',
      campaign: '120244144794240528',
      keyword: '120244145635460528',
      creative: '',
    });
    const row = transformSession(session, TEST_BATCH_ID);
    expect(row.join_status).toBe('unjoinable');
    expect(row.join_issue).toContain('ad_id');
  });

  it('classifies fixture session with empty UTMs as unjoinable', () => {
    // Third session in fixture has empty source, campaign, keyword, creative
    const session = ghstlySessions.items[2] as GhstlySession;
    expect(session.source).toBe('');
    const row = transformSession(session, TEST_BATCH_ID);
    expect(row.join_status).toBe('unjoinable');
  });
});

describe('transformDailyStatsRow — joinability classification', () => {
  it('classifies a normal stats row as joinable', () => {
    const statsRow: GhstlyStatsDailyRow = {
      date: '2026-03-21',
      campaign_id: '120244033805690528',
      adset_id: '120244038423200528',
      ad_id: '120244038423210528',
      visits: 4,
      chats: 3,
      reveals: 2,
      click_throughs: 2,
      conversions: 0,
    };
    const row = transformDailyStatsRow(statsRow, TEST_BATCH_ID);
    expect(row.join_status).toBe('joinable');
    expect(row.join_issue).toBeNull();
  });

  it('classifies link_in_bio ad_id as unjoinable', () => {
    // First row in ghstly-stats.json has ad_id = "link_in_bio" and null campaign_id
    const statsRow = ghstlyStats.items[0] as GhstlyStatsDailyRow;
    // Add a date since stats fixture doesn't have it
    const row = transformDailyStatsRow({ ...statsRow, date: '2026-03-21' }, TEST_BATCH_ID);
    expect(row.join_status).toBe('unjoinable');
    expect(row.join_issue).toContain('null');
  });

  it('classifies {{campaign.id}} placeholder as unjoinable', () => {
    // Row with placeholder values in fixture
    const placeholderRow = ghstlyStats.items.find(
      (item) => item.campaign_id === '{{campaign.id}}',
    );
    expect(placeholderRow).toBeDefined();
    const row = transformDailyStatsRow(
      { ...placeholderRow!, date: '2026-03-21' } as GhstlyStatsDailyRow,
      TEST_BATCH_ID,
    );
    expect(row.join_status).toBe('unjoinable');
    expect(row.join_issue).toContain('placeholder');
    expect(row.join_issue).toContain('{{campaign.id}}');
  });

  it('classifies null campaign_id as unjoinable', () => {
    const row = transformDailyStatsRow(
      {
        date: '2026-03-21',
        campaign_id: null,
        adset_id: null,
        ad_id: 'link_in_bio',
        visits: 659,
        chats: 499,
        reveals: 153,
        click_throughs: 102,
        conversions: 6,
      },
      TEST_BATCH_ID,
    );
    expect(row.join_status).toBe('unjoinable');
    expect(row.join_issue).toContain('campaign_id is null');
  });
});

// ---------------------------------------------------------------------------
// Tests: PII Stripping
// ---------------------------------------------------------------------------

describe('transformSession — PII stripping', () => {
  it('does not include ip_address in the output row', () => {
    const session = makeSession({
      ip_address: '192.168.1.1',
    });
    const row = transformSession(session, TEST_BATCH_ID);
    expect('ip_address' in row).toBe(false);
  });

  it('does not include user_agent in the output row', () => {
    const session = makeSession({
      user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6)',
    });
    const row = transformSession(session, TEST_BATCH_ID);
    expect('user_agent' in row).toBe(false);
  });

  it('strips PII from all fixture sessions', () => {
    const sessions = ghstlySessions.items as GhstlySession[];
    for (const session of sessions) {
      // Verify fixture sessions DO have PII
      expect(session.ip_address).toBeTruthy();
      expect(session.user_agent).toBeTruthy();

      // Verify transformed rows do NOT have PII
      const row = transformSession(session, TEST_BATCH_ID);
      const rowKeys = Object.keys(row);
      expect(rowKeys).not.toContain('ip_address');
      expect(rowKeys).not.toContain('user_agent');
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: Daily Stats Transformation
// ---------------------------------------------------------------------------

describe('transformDailyStatsRow', () => {
  it('preserves all metric values', () => {
    const input: GhstlyStatsDailyRow = {
      date: '2026-03-21',
      campaign_id: '120244033805690528',
      adset_id: '120244038423200528',
      ad_id: '120244038423210528',
      visits: 4,
      chats: 3,
      reveals: 2,
      click_throughs: 2,
      conversions: 0,
    };
    const row = transformDailyStatsRow(input, TEST_BATCH_ID);

    expect(row.report_date).toBe('2026-03-21');
    expect(row.entity_level).toBe('ad');
    expect(row.entity_id).toBe('120244038423210528');
    expect(row.campaign_id).toBe('120244033805690528');
    expect(row.adset_id).toBe('120244038423200528');
    expect(row.ad_id).toBe('120244038423210528');
    expect(row.visits).toBe(4);
    expect(row.chats).toBe(3);
    expect(row.reveals).toBe(2);
    expect(row.click_throughs).toBe(2);
    expect(row.ghstly_conversions).toBe(0);
  });

  it('attaches sync_batch_id', () => {
    const input: GhstlyStatsDailyRow = {
      date: '2026-03-21',
      campaign_id: '120244033805690528',
      adset_id: '120244038423200528',
      ad_id: '120244038423210528',
      visits: 4,
      chats: 3,
      reveals: 2,
      click_throughs: 2,
      conversions: 0,
    };
    const row = transformDailyStatsRow(input, TEST_BATCH_ID);
    expect(row.sync_batch_id).toBe(TEST_BATCH_ID);
  });

  it('transforms all fixture daily stats rows', () => {
    const items = ghstlyStatsDaily.items as GhstlyStatsDailyRow[];
    const rows = items.map((item) => transformDailyStatsRow(item, TEST_BATCH_ID));

    expect(rows.length).toBe(items.length);
    for (const row of rows) {
      expect(row.sync_batch_id).toBe(TEST_BATCH_ID);
      expect(row.join_status).toBeDefined();
      expect(['joinable', 'unjoinable']).toContain(row.join_status);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: Sync Idempotency
// ---------------------------------------------------------------------------

describe('sync idempotency', () => {
  let mockClient: GhstlyClient;
  let mockPersistence: GhstlyPersistence;

  beforeEach(() => {
    mockClient = makeMockClient();
    mockPersistence = makeMockPersistence();
  });

  it('syncGhstlyIncremental calls upsert (not insert), making it idempotent', async () => {
    await syncGhstlyIncremental(mockClient, mockPersistence);

    // Verify upsert was called, not insert
    expect(mockPersistence.upsertDailyGhstlyStats).toHaveBeenCalledTimes(1);
    expect(mockPersistence.upsertSessions).toHaveBeenCalledTimes(1);
  });

  it('running incremental sync twice produces same transformed data', async () => {
    // First run
    const result1 = await syncGhstlyIncremental(mockClient, mockPersistence);

    // Reset mock call tracking
    vi.mocked(mockPersistence.upsertDailyGhstlyStats).mockClear();
    vi.mocked(mockPersistence.upsertSessions).mockClear();
    vi.mocked(mockPersistence.insertSyncLog).mockClear();

    // Second run (new client to get fresh batch IDs but same data)
    const result2 = await syncGhstlyIncremental(mockClient, mockPersistence);

    // Same number of rows
    expect(result1.dailyStatsRows.length).toBe(result2.dailyStatsRows.length);
    expect(result1.sessionRows.length).toBe(result2.sessionRows.length);

    // Same data content (ignoring sync_batch_id which is unique per run)
    const stripBatchId = (row: DailyGhstlyStatsRow) => {
      const { sync_batch_id: _, ...rest } = row;
      return rest;
    };
    const stripSessionBatchId = (row: SessionRow) => {
      const { sync_batch_id: _, ...rest } = row;
      return rest;
    };

    expect(result1.dailyStatsRows.map(stripBatchId)).toEqual(
      result2.dailyStatsRows.map(stripBatchId),
    );
    expect(result1.sessionRows.map(stripSessionBatchId)).toEqual(
      result2.sessionRows.map(stripSessionBatchId),
    );
  });

  it('syncGhstlyBackfill produces valid rows from fixture data', async () => {
    const result = await syncGhstlyBackfill(mockClient, mockPersistence, 30);

    expect(result.dailyStatsRows.length).toBeGreaterThan(0);
    expect(result.sessionRows.length).toBeGreaterThan(0);

    // All rows have sync_batch_id
    for (const row of result.dailyStatsRows) {
      expect(row.sync_batch_id).toBeTruthy();
      expect(row.sync_batch_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
    }
    for (const row of result.sessionRows) {
      expect(row.sync_batch_id).toBeTruthy();
      expect(row.sync_batch_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
    }
  });

  it('sync logs are written to persistence', async () => {
    await syncGhstlyIncremental(mockClient, mockPersistence);

    // Should have logs for daily_stats, stats_summaries, and sessions stages
    expect(mockPersistence.insertSyncLog).toHaveBeenCalled();
    const calls = vi.mocked(mockPersistence.insertSyncLog).mock.calls;
    const stages = calls.map((c) => c[0].stage);
    expect(stages).toContain('daily_stats');
    expect(stages).toContain('sessions');
  });

  it('filtered stats summaries are fetched for exact campaign/adset totals', async () => {
    const result = await syncGhstlyIncremental(mockClient, mockPersistence);

    // Should have fetched overall stats at minimum
    expect(result.filteredSummaries.has('overall')).toBe(true);

    // fetchStats should be called at least once (overall) + once per unique campaign_id
    expect(vi.mocked(mockClient.fetchStats as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Tests: Session row completeness
// ---------------------------------------------------------------------------

describe('transformSession — row completeness', () => {
  it('preserves all non-PII session fields', () => {
    const session = makeSession();
    const row = transformSession(session, TEST_BATCH_ID);

    expect(row.id).toBe(session.session_id);
    expect(row.created_at_utc).toBe(session.created_at);
    expect(row.started_at_utc).toBe(session.started_at);
    expect(row.ended_at_utc).toBe(session.ended_at);
    expect(row.status).toBe(session.status);
    expect(row.messages_count).toBe(session.messages_count);
    expect(row.brand).toBe(session.brand);
    expect(row.reached_reveal).toBe(session.reached_reveal);
    expect(row.clicked_through).toBe(session.clicked_through);
    expect(row.converted).toBe(session.converted);
    expect(row.city).toBe(session.city);
    expect(row.region).toBe(session.region);
    expect(row.country).toBe(session.country);
  });

  it('has exactly the expected keys (no extra, no missing)', () => {
    const session = makeSession();
    const row = transformSession(session, TEST_BATCH_ID);
    const keys = Object.keys(row).sort();

    const expectedKeys = [
      'ad_id',
      'adset_id',
      'brand',
      'campaign_id',
      'city',
      'clicked_through',
      'converted',
      'country',
      'created_at_utc',
      'ended_at_utc',
      'id',
      'join_issue',
      'join_status',
      'messages_count',
      'reached_reveal',
      'region',
      'started_at_utc',
      'status',
      'sync_batch_id',
    ].sort();

    expect(keys).toEqual(expectedKeys);
  });
});
