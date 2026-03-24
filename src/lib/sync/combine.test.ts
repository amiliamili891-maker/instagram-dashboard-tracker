/**
 * Tests for Combined Dataset Engine
 *
 * Covers:
 *   - All 9 derived metric computations
 *   - Zero-denominator edge cases (returns null)
 *   - Joined row building
 *   - Meta-only partial row building
 *   - Ghstly-only partial row building
 *   - Batch alignment logic
 *   - Full materialization with mocked persistence
 *   - Unmatched row handling
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  safeDivide,
  computeDerivedMetrics,
  buildJoinedRow,
  buildMetaOnlyRow,
  buildGhstlyOnlyRow,
  materializeCombinedStats,
  type MetaStatsRow,
  type GhstlyStatsRow,
  type SyncLogRow,
  type CombinePersistence,
} from './combine';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeMetaRow(overrides: Partial<MetaStatsRow> = {}): MetaStatsRow {
  return {
    report_date: '2026-03-20',
    entity_level: 'ad',
    entity_id: 'ad_001',
    campaign_id: 'campaign_001',
    adset_id: 'adset_001',
    ad_id: 'ad_001',
    spend: 50.0,
    impressions: 5000,
    clicks: 100,
    unique_clicks: 80,
    cpc: 0.5,
    cpm: 10.0,
    ctr: 2.0,
    meta_conversions: null,
    cost_per_action: null,
    sync_batch_id: 'meta-batch-001',
    ...overrides,
  };
}

function makeGhstlyRow(overrides: Partial<GhstlyStatsRow> = {}): GhstlyStatsRow {
  return {
    report_date: '2026-03-20',
    entity_level: 'ad',
    entity_id: 'ad_001',
    campaign_id: 'campaign_001',
    adset_id: 'adset_001',
    ad_id: 'ad_001',
    visits: 200,
    chats: 50,
    reveals: 20,
    click_throughs: 10,
    ghstly_conversions: 3,
    join_status: 'joinable',
    join_issue: null,
    sync_batch_id: 'ghstly-batch-001',
    ...overrides,
  };
}

function makeSyncLog(overrides: Partial<SyncLogRow> = {}): SyncLogRow {
  return {
    sync_batch_id: 'batch-001',
    source: 'meta',
    stage: 'persist',
    status: 'success',
    started_at: '2026-03-20T10:00:00.000Z',
    completed_at: '2026-03-20T10:05:00.000Z',
    ...overrides,
  };
}

function makeMockPersistence(
  metaRows: MetaStatsRow[] = [],
  ghstlyRows: GhstlyStatsRow[] = [],
  syncLogs: SyncLogRow[] = [],
): CombinePersistence {
  return {
    fetchMetaStats: vi.fn().mockResolvedValue(metaRows),
    fetchGhstlyStats: vi.fn().mockResolvedValue(ghstlyRows),
    fetchSyncLogs: vi.fn().mockResolvedValue(syncLogs),
    upsertCombinedStats: vi.fn().mockImplementation((rows) => Promise.resolve(rows.length)),
  };
}

// ---------------------------------------------------------------------------
// safeDivide
// ---------------------------------------------------------------------------

describe('safeDivide', () => {
  it('returns correct division result', () => {
    expect(safeDivide(100, 50)).toBe(2);
  });

  it('returns null when denominator is zero', () => {
    expect(safeDivide(100, 0)).toBeNull();
  });

  it('returns null when denominator is null', () => {
    expect(safeDivide(100, null)).toBeNull();
  });

  it('returns null when numerator is null', () => {
    expect(safeDivide(null, 50)).toBeNull();
  });

  it('returns null when both are null', () => {
    expect(safeDivide(null, null)).toBeNull();
  });

  it('handles fractional results', () => {
    expect(safeDivide(1, 3)).toBeCloseTo(0.3333, 4);
  });
});

// ---------------------------------------------------------------------------
// computeDerivedMetrics — all 9 metrics
// ---------------------------------------------------------------------------

describe('computeDerivedMetrics', () => {
  const meta = { spend: 50, impressions: 5000, clicks: 100, unique_clicks: 80 };
  const ghstly = { visits: 200, chats: 50, reveals: 20, click_throughs: 10 };

  it('computes chat_rate = chats / visits', () => {
    const result = computeDerivedMetrics(meta, ghstly);
    expect(result.chat_rate).toBe(50 / 200);
  });

  it('computes cost_per_chat = spend / chats', () => {
    const result = computeDerivedMetrics(meta, ghstly);
    expect(result.cost_per_chat).toBe(50 / 50);
  });

  it('computes reveal_rate = reveals / chats', () => {
    const result = computeDerivedMetrics(meta, ghstly);
    expect(result.reveal_rate).toBe(20 / 50);
  });

  it('computes cost_per_reveal = spend / reveals', () => {
    const result = computeDerivedMetrics(meta, ghstly);
    expect(result.cost_per_reveal).toBe(50 / 20);
  });

  it('computes reveal_click_through_rate = click_throughs / chats', () => {
    const result = computeDerivedMetrics(meta, ghstly);
    expect(result.reveal_click_through_rate).toBe(10 / 50);
  });

  it('computes cost_per_unique_click = spend / unique_clicks', () => {
    const result = computeDerivedMetrics(meta, ghstly);
    expect(result.cost_per_unique_click).toBe(50 / 80);
  });

  it('computes ctr = clicks / impressions', () => {
    const result = computeDerivedMetrics(meta, ghstly);
    expect(result.ctr).toBe(100 / 5000);
  });

  it('computes cpc = spend / clicks', () => {
    const result = computeDerivedMetrics(meta, ghstly);
    expect(result.cpc).toBe(50 / 100);
  });

  it('computes cpm = (spend / impressions) * 1000', () => {
    const result = computeDerivedMetrics(meta, ghstly);
    expect(result.cpm).toBe((50 / 5000) * 1000);
  });
});

// ---------------------------------------------------------------------------
// computeDerivedMetrics — zero denominator edge cases
// ---------------------------------------------------------------------------

describe('computeDerivedMetrics — zero denominator', () => {
  it('returns null for chat_rate when visits is 0', () => {
    const result = computeDerivedMetrics(
      { spend: 50, impressions: 5000, clicks: 100, unique_clicks: 80 },
      { visits: 0, chats: 50, reveals: 20, click_throughs: 10 },
    );
    expect(result.chat_rate).toBeNull();
  });

  it('returns null for cost_per_chat when chats is 0', () => {
    const result = computeDerivedMetrics(
      { spend: 50, impressions: 5000, clicks: 100, unique_clicks: 80 },
      { visits: 200, chats: 0, reveals: 20, click_throughs: 10 },
    );
    expect(result.cost_per_chat).toBeNull();
  });

  it('returns null for reveal_rate when chats is 0', () => {
    const result = computeDerivedMetrics(
      { spend: 50, impressions: 5000, clicks: 100, unique_clicks: 80 },
      { visits: 200, chats: 0, reveals: 20, click_throughs: 10 },
    );
    expect(result.reveal_rate).toBeNull();
  });

  it('returns null for cost_per_reveal when reveals is 0', () => {
    const result = computeDerivedMetrics(
      { spend: 50, impressions: 5000, clicks: 100, unique_clicks: 80 },
      { visits: 200, chats: 50, reveals: 0, click_throughs: 10 },
    );
    expect(result.cost_per_reveal).toBeNull();
  });

  it('returns null for reveal_click_through_rate when chats is 0', () => {
    const result = computeDerivedMetrics(
      { spend: 50, impressions: 5000, clicks: 100, unique_clicks: 80 },
      { visits: 200, chats: 0, reveals: 0, click_throughs: 10 },
    );
    expect(result.reveal_click_through_rate).toBeNull();
  });

  it('returns null for cost_per_unique_click when unique_clicks is 0', () => {
    const result = computeDerivedMetrics(
      { spend: 50, impressions: 5000, clicks: 100, unique_clicks: 0 },
      { visits: 200, chats: 50, reveals: 20, click_throughs: 10 },
    );
    expect(result.cost_per_unique_click).toBeNull();
  });

  it('returns null for ctr when impressions is 0', () => {
    const result = computeDerivedMetrics(
      { spend: 50, impressions: 0, clicks: 100, unique_clicks: 80 },
      { visits: 200, chats: 50, reveals: 20, click_throughs: 10 },
    );
    expect(result.ctr).toBeNull();
  });

  it('returns null for cpc when clicks is 0', () => {
    const result = computeDerivedMetrics(
      { spend: 50, impressions: 5000, clicks: 0, unique_clicks: 80 },
      { visits: 200, chats: 50, reveals: 20, click_throughs: 10 },
    );
    expect(result.cpc).toBeNull();
  });

  it('returns null for cpm when impressions is 0', () => {
    const result = computeDerivedMetrics(
      { spend: 50, impressions: 0, clicks: 100, unique_clicks: 80 },
      { visits: 200, chats: 50, reveals: 20, click_throughs: 10 },
    );
    expect(result.cpm).toBeNull();
  });

  it('returns all nulls when all denominators are null', () => {
    const result = computeDerivedMetrics(
      { spend: null, impressions: null, clicks: null, unique_clicks: null },
      { visits: null, chats: null, reveals: null, click_throughs: null },
    );
    expect(result.chat_rate).toBeNull();
    expect(result.cost_per_chat).toBeNull();
    expect(result.reveal_rate).toBeNull();
    expect(result.cost_per_reveal).toBeNull();
    expect(result.reveal_click_through_rate).toBeNull();
    expect(result.cost_per_unique_click).toBeNull();
    expect(result.ctr).toBeNull();
    expect(result.cpc).toBeNull();
    expect(result.cpm).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildJoinedRow
// ---------------------------------------------------------------------------

describe('buildJoinedRow', () => {
  it('builds a joined row with all metrics and derived values', () => {
    const meta = makeMetaRow();
    const ghstly = makeGhstlyRow();
    const row = buildJoinedRow(meta, ghstly);

    expect(row.join_status).toBe('joinable');
    expect(row.report_date).toBe('2026-03-20');
    expect(row.entity_level).toBe('ad');
    expect(row.entity_id).toBe('ad_001');
    expect(row.meta_batch_id).toBe('meta-batch-001');
    expect(row.ghstly_batch_id).toBe('ghstly-batch-001');
    expect(row.spend).toBe(50);
    expect(row.visits).toBe(200);
    expect(row.chat_rate).toBe(50 / 200);
    expect(row.cost_per_chat).toBe(50 / 50);
  });

  it('preserves null for meta_conversions when null', () => {
    const meta = makeMetaRow({ meta_conversions: null });
    const ghstly = makeGhstlyRow();
    const row = buildJoinedRow(meta, ghstly);
    expect(row.meta_conversions).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildMetaOnlyRow
// ---------------------------------------------------------------------------

describe('buildMetaOnlyRow', () => {
  it('builds a partial row with Meta data and null Ghstly metrics', () => {
    const meta = makeMetaRow();
    const row = buildMetaOnlyRow(meta);

    expect(row.join_status).toBe('partial');
    expect(row.meta_batch_id).toBe('meta-batch-001');
    expect(row.ghstly_batch_id).toBeNull();
    expect(row.spend).toBe(50);
    expect(row.impressions).toBe(5000);

    // Ghstly metrics are null
    expect(row.visits).toBeNull();
    expect(row.chats).toBeNull();
    expect(row.reveals).toBeNull();
    expect(row.click_throughs).toBeNull();
    expect(row.ghstly_conversions).toBeNull();

    // Cross-source derived metrics are null
    expect(row.chat_rate).toBeNull();
    expect(row.cost_per_chat).toBeNull();
    expect(row.reveal_rate).toBeNull();
    expect(row.cost_per_reveal).toBeNull();
    expect(row.reveal_click_through_rate).toBeNull();

    // Meta-only derived metrics are computed
    expect(row.ctr).toBe(100 / 5000);
    expect(row.cpc).toBe(50 / 100);
    expect(row.cpm).toBe((50 / 5000) * 1000);
    expect(row.cost_per_unique_click).toBe(50 / 80);
  });
});

// ---------------------------------------------------------------------------
// buildGhstlyOnlyRow
// ---------------------------------------------------------------------------

describe('buildGhstlyOnlyRow', () => {
  it('builds a partial row with Ghstly data and null Meta metrics', () => {
    const ghstly = makeGhstlyRow();
    const row = buildGhstlyOnlyRow(ghstly);

    expect(row.join_status).toBe('partial');
    expect(row.meta_batch_id).toBeNull();
    expect(row.ghstly_batch_id).toBe('ghstly-batch-001');

    // Meta metrics are null
    expect(row.spend).toBeNull();
    expect(row.impressions).toBeNull();
    expect(row.clicks).toBeNull();
    expect(row.unique_clicks).toBeNull();

    // Ghstly metrics are present
    expect(row.visits).toBe(200);
    expect(row.chats).toBe(50);
    expect(row.reveals).toBe(20);
    expect(row.click_throughs).toBe(10);
    expect(row.ghstly_conversions).toBe(3);

    // Ghstly-only derived metrics are computed
    expect(row.chat_rate).toBe(50 / 200);
    expect(row.reveal_rate).toBe(20 / 50);
    expect(row.reveal_click_through_rate).toBe(10 / 50); // click_throughs / chats
    expect(row.conversion_rate).toBe(3 / 50); // conversions / chats

    // Cross-source metrics requiring spend are null
    expect(row.cost_per_chat).toBeNull();
    expect(row.cost_per_reveal).toBeNull();
    expect(row.cost_per_unique_click).toBeNull();
    expect(row.ctr).toBeNull();
    expect(row.cpc).toBeNull();
    expect(row.cpm).toBeNull();
  });
});

// areBatchesAligned — removed (dead code: alignment is guaranteed by the orchestrator)

// ---------------------------------------------------------------------------
// materializeCombinedStats — full flow
// ---------------------------------------------------------------------------

describe('materializeCombinedStats', () => {
  const dateRange = { from: '2026-03-20', to: '2026-03-20' };

  it('joins matching Meta and Ghstly rows', async () => {
    const metaRow = makeMetaRow();
    const ghstlyRow = makeGhstlyRow();
    const syncLogs = [
      makeSyncLog({ sync_batch_id: 'meta-batch-001', source: 'meta', completed_at: '2026-03-20T10:00:00.000Z' }),
      makeSyncLog({ sync_batch_id: 'ghstly-batch-001', source: 'ghstly', completed_at: '2026-03-20T10:05:00.000Z' }),
    ];
    const persistence = makeMockPersistence([metaRow], [ghstlyRow], syncLogs);

    const result = await materializeCombinedStats(persistence, dateRange);

    expect(result.batchAligned).toBe(true);
    expect(result.joinableRows).toBe(1);
    expect(result.metaOnlyRows).toBe(0);
    expect(result.ghstlyOnlyRows).toBe(0);
    expect(result.rowsUpserted).toBe(1);

    // Verify upsert was called with correct data
    const upsertCall = vi.mocked(persistence.upsertCombinedStats).mock.calls[0][0];
    expect(upsertCall).toHaveLength(1);
    expect(upsertCall[0].join_status).toBe('joinable');
    expect(upsertCall[0].spend).toBe(50);
    expect(upsertCall[0].chats).toBe(50);
  });

  it('creates Meta-only partial rows for unmatched Meta data', async () => {
    const metaRow = makeMetaRow({ entity_id: 'ad_meta_only' });
    const syncLogs = [
      makeSyncLog({ sync_batch_id: 'meta-batch-001', source: 'meta', completed_at: '2026-03-20T10:00:00.000Z' }),
      makeSyncLog({ sync_batch_id: 'ghstly-batch-001', source: 'ghstly', completed_at: '2026-03-20T10:05:00.000Z' }),
    ];
    // No ghstly rows but batches are aligned
    const persistence = makeMockPersistence([metaRow], [], syncLogs);

    const result = await materializeCombinedStats(persistence, dateRange);

    expect(result.metaOnlyRows).toBe(1);
    expect(result.ghstlyOnlyRows).toBe(0);
    expect(result.joinableRows).toBe(0);
  });

  it('creates Ghstly-only partial rows for unmatched Ghstly data', async () => {
    const ghstlyRow = makeGhstlyRow({ entity_id: 'ad_ghstly_only' });
    const syncLogs = [
      makeSyncLog({ sync_batch_id: 'meta-batch-001', source: 'meta', completed_at: '2026-03-20T10:00:00.000Z' }),
      makeSyncLog({ sync_batch_id: 'ghstly-batch-001', source: 'ghstly', completed_at: '2026-03-20T10:05:00.000Z' }),
    ];
    const persistence = makeMockPersistence([], [ghstlyRow], syncLogs);

    const result = await materializeCombinedStats(persistence, dateRange);

    expect(result.ghstlyOnlyRows).toBe(1);
    expect(result.metaOnlyRows).toBe(0);
    expect(result.joinableRows).toBe(0);
  });

  it('handles mix of joined, Meta-only, and Ghstly-only rows', async () => {
    const metaRows = [
      makeMetaRow({ entity_id: 'ad_001' }),
      makeMetaRow({ entity_id: 'ad_meta_only' }),
    ];
    const ghstlyRows = [
      makeGhstlyRow({ entity_id: 'ad_001' }),
      makeGhstlyRow({ entity_id: 'ad_ghstly_only' }),
    ];
    const syncLogs = [
      makeSyncLog({ sync_batch_id: 'meta-batch-001', source: 'meta', completed_at: '2026-03-20T10:00:00.000Z' }),
      makeSyncLog({ sync_batch_id: 'ghstly-batch-001', source: 'ghstly', completed_at: '2026-03-20T10:05:00.000Z' }),
    ];
    const persistence = makeMockPersistence(metaRows, ghstlyRows, syncLogs);

    const result = await materializeCombinedStats(persistence, dateRange);

    expect(result.joinableRows).toBe(1);
    expect(result.metaOnlyRows).toBe(1);
    expect(result.ghstlyOnlyRows).toBe(1);
    expect(result.rowsUpserted).toBe(3);
  });

  it('unjoinable Ghstly rows appear as Ghstly-only partials (not joined with Meta)', async () => {
    const metaRow = makeMetaRow();
    const ghstlyRow = makeGhstlyRow({ join_status: 'unjoinable' });
    const syncLogs = [
      makeSyncLog({ sync_batch_id: 'meta-batch-001', source: 'meta', completed_at: '2026-03-20T10:00:00.000Z' }),
      makeSyncLog({ sync_batch_id: 'ghstly-batch-001', source: 'ghstly', completed_at: '2026-03-20T10:05:00.000Z' }),
    ];
    const persistence = makeMockPersistence([metaRow], [ghstlyRow], syncLogs);

    const result = await materializeCombinedStats(persistence, dateRange);

    // Unjoinable Ghstly row does NOT join with Meta row (no spend attribution)
    expect(result.joinableRows).toBe(0);
    expect(result.metaOnlyRows).toBe(1);
    // Unjoinable Ghstly rows now appear as Ghstly-only partials so chats are counted
    expect(result.ghstlyOnlyRows).toBe(1);
    expect(result.rowsUpserted).toBe(2);
  });

  it('publishes even with different batch IDs (alignment skipped in v1)', async () => {
    const metaRow = makeMetaRow();
    const ghstlyRow = makeGhstlyRow();
    const syncLogs = [
      makeSyncLog({ sync_batch_id: 'meta-batch-001', source: 'meta', completed_at: '2026-03-20T01:00:00.000Z' }),
      makeSyncLog({ sync_batch_id: 'ghstly-batch-001', source: 'ghstly', completed_at: '2026-03-20T10:00:00.000Z' }),
    ];
    const persistence = makeMockPersistence([metaRow], [ghstlyRow], syncLogs);

    const result = await materializeCombinedStats(persistence, dateRange);

    expect(result.batchAligned).toBe(true);
    expect(result.rowsUpserted).toBeGreaterThan(0);
  });

  it('handles empty datasets gracefully', async () => {
    const persistence = makeMockPersistence([], [], []);

    const result = await materializeCombinedStats(persistence, dateRange);

    expect(result.batchAligned).toBe(true);
    expect(result.rowsUpserted).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Rollup correctness — entity levels
// ---------------------------------------------------------------------------

describe('rollup correctness', () => {
  it('joins at campaign level', () => {
    const meta = makeMetaRow({ entity_level: 'campaign', entity_id: 'campaign_001' });
    const ghstly = makeGhstlyRow({ entity_level: 'campaign', entity_id: 'campaign_001' });
    const row = buildJoinedRow(meta, ghstly);

    expect(row.entity_level).toBe('campaign');
    expect(row.entity_id).toBe('campaign_001');
    expect(row.join_status).toBe('joinable');
  });

  it('joins at adset level', () => {
    const meta = makeMetaRow({ entity_level: 'adset', entity_id: 'adset_001' });
    const ghstly = makeGhstlyRow({ entity_level: 'adset', entity_id: 'adset_001' });
    const row = buildJoinedRow(meta, ghstly);

    expect(row.entity_level).toBe('adset');
    expect(row.entity_id).toBe('adset_001');
  });

  it('does NOT join across entity levels', async () => {
    const metaRow = makeMetaRow({ entity_level: 'campaign', entity_id: 'campaign_001' });
    const ghstlyRow = makeGhstlyRow({ entity_level: 'ad', entity_id: 'campaign_001' });
    const syncLogs = [
      makeSyncLog({ sync_batch_id: 'meta-batch-001', source: 'meta', completed_at: '2026-03-20T10:00:00.000Z' }),
      makeSyncLog({ sync_batch_id: 'ghstly-batch-001', source: 'ghstly', completed_at: '2026-03-20T10:05:00.000Z' }),
    ];
    const persistence = makeMockPersistence([metaRow], [ghstlyRow], syncLogs);

    const result = await materializeCombinedStats(persistence, { from: '2026-03-20', to: '2026-03-20' });

    // Different entity levels should not join
    expect(result.joinableRows).toBe(0);
    expect(result.metaOnlyRows).toBe(1);
    expect(result.ghstlyOnlyRows).toBe(1);
  });
});
