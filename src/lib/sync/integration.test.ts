/**
 * Integration Test — Full Sync Pipeline
 *
 * Tests the end-to-end data flow through:
 *   orchestrator → meta-sync → ghstly-sync → combine → freshness
 *
 * All persistence is mocked (no real Supabase). The focus is on verifying
 * that data flows correctly between pipeline stages and that the orchestrator
 * coordinates everything properly including sync_logs, error handling,
 * and the combine step producing correct aggregated data.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  runCombinedSync,
  type MetaSyncFn,
  type GhstlySyncFn,
  type OrchestratorPersistence,
  type OrchestratorSyncLog,
} from './orchestrator';

import {
  materializeCombinedStats,
  type MetaStatsRow,
  type GhstlyStatsRow,
  type CombinePersistence,
} from './combine';

import {
  computeFreshness,
  type SyncLogRow as FreshnessSyncLogRow,
} from './freshness';

import {
  evaluateDataQuality,
  type QualityInput,
} from './data-quality';

// ---------------------------------------------------------------------------
// Shared test constants
// ---------------------------------------------------------------------------

const REPORT_DATE = '2026-03-21';
const ENTITY_ID_AD = 'ad_integration_001';
const ENTITY_ID_CAMPAIGN = 'campaign_integration_001';
const META_BATCH_ID = 'meta-batch-integration';
const GHSTLY_BATCH_ID = 'ghstly-batch-integration';

// ---------------------------------------------------------------------------
// Fixture factories (matching patterns from combine.test.ts)
// ---------------------------------------------------------------------------

function makeMetaRow(overrides: Partial<MetaStatsRow> = {}): MetaStatsRow {
  return {
    report_date: REPORT_DATE,
    entity_level: 'ad',
    entity_id: ENTITY_ID_AD,
    campaign_id: ENTITY_ID_CAMPAIGN,
    adset_id: 'adset_001',
    ad_id: ENTITY_ID_AD,
    spend: 100.0,
    impressions: 10000,
    clicks: 200,
    unique_clicks: 160,
    cpc: 0.5,
    cpm: 10.0,
    ctr: 2.0,
    meta_conversions: 5,
    cost_per_action: 20.0,
    sync_batch_id: META_BATCH_ID,
    ...overrides,
  };
}

function makeGhstlyRow(overrides: Partial<GhstlyStatsRow> = {}): GhstlyStatsRow {
  return {
    report_date: REPORT_DATE,
    entity_level: 'ad',
    entity_id: ENTITY_ID_AD,
    campaign_id: ENTITY_ID_CAMPAIGN,
    adset_id: 'adset_001',
    ad_id: ENTITY_ID_AD,
    visits: 400,
    chats: 100,
    reveals: 40,
    click_throughs: 20,
    ghstly_conversions: 6,
    join_status: 'joinable',
    join_issue: null,
    sync_batch_id: GHSTLY_BATCH_ID,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock persistence factories (matching orchestrator.test.ts patterns)
// ---------------------------------------------------------------------------

function createMockOrchestratorPersistence(
  runningSync: { sync_batch_id: string; started_at: string } | null = null,
) {
  const logs: OrchestratorSyncLog[] = [];
  return {
    persistence: {
      insertSyncLog: vi.fn(async (entry: OrchestratorSyncLog) => {
        logs.push(entry);
      }),
      findRunningSync: vi.fn(async () => runningSync),
    } satisfies OrchestratorPersistence,
    logs,
  };
}

function createMockCombinePersistence(
  metaRows: MetaStatsRow[] = [],
  ghstlyRows: GhstlyStatsRow[] = [],
): CombinePersistence {
  return {
    fetchMetaStats: vi.fn().mockResolvedValue(metaRows),
    fetchGhstlyStats: vi.fn().mockResolvedValue(ghstlyRows),
    fetchSyncLogs: vi.fn().mockResolvedValue([]),
    upsertCombinedStats: vi.fn().mockImplementation((rows) => Promise.resolve(rows.length)),
  };
}

// ---------------------------------------------------------------------------
// Integration: Orchestrator → Sync Functions → Sync Logs
// ---------------------------------------------------------------------------

describe('Integration: full pipeline data flow', () => {
  describe('orchestrator coordinates meta + ghstly syncs and produces correct sync_logs', () => {
    it('successful pipeline produces running → fetch → persist logs for both sources + combined success', async () => {
      const { persistence, logs } = createMockOrchestratorPersistence();

      const metaSync: MetaSyncFn = vi.fn(async () => ({
        recordsSynced: 42,
        watermarkDate: REPORT_DATE,
      }));

      const ghstlySync: GhstlySyncFn = vi.fn(async () => ({
        recordsSynced: 100,
        watermarkDate: REPORT_DATE,
      }));

      const result = await runCombinedSync(
        'incremental',
        persistence,
        metaSync,
        ghstlySync,
        { maxRetries: 0, triggeredBy: 'integration-test' },
      );

      // Verify orchestrator result
      expect(result.metaSuccess).toBe(true);
      expect(result.ghstlySuccess).toBe(true);
      expect(result.type).toBe('incremental');
      expect(result.totalRetries).toBe(0);

      // Verify sync_logs structure: 6 entries expected
      // First: combined/orchestrate/running
      // Middle (parallel, order not guaranteed): meta/fetch, meta/persist, ghstly/fetch, ghstly/persist
      // Last: combined/orchestrate/success
      expect(logs).toHaveLength(6);

      // All logs share the same sync_batch_id
      const batchId = result.syncBatchId;
      expect(logs.every((l) => l.sync_batch_id === batchId)).toBe(true);

      // First log is always the orchestrate lock
      expect(logs[0]).toMatchObject({ source: 'combined', stage: 'orchestrate', status: 'running' });
      // Last log is always the orchestrate completion
      expect(logs[5]).toMatchObject({ source: 'combined', stage: 'orchestrate', status: 'success' });

      // Middle 4 logs contain meta and ghstly fetch+persist (order not guaranteed due to parallel execution)
      const middleLogs = logs.slice(1, 5);
      expect(middleLogs).toEqual(expect.arrayContaining([
        expect.objectContaining({ source: 'meta', stage: 'fetch', status: 'running' }),
        expect.objectContaining({ source: 'meta', stage: 'persist', status: 'success', records_synced: 42 }),
        expect.objectContaining({ source: 'ghstly', stage: 'fetch', status: 'running' }),
        expect.objectContaining({ source: 'ghstly', stage: 'persist', status: 'success', records_synced: 100 }),
      ]));

      // Verify triggered_by propagates through all logs
      expect(logs.every((l) => l.triggered_by === 'integration-test')).toBe(true);

      // Verify watermark dates are recorded on persist-success logs
      const metaPersist = middleLogs.find((l) => l.source === 'meta' && l.stage === 'persist');
      const ghstlyPersist = middleLogs.find((l) => l.source === 'ghstly' && l.stage === 'persist');
      expect(metaPersist?.watermark_date).toBe(REPORT_DATE);
      expect(ghstlyPersist?.watermark_date).toBe(REPORT_DATE);

      // Verify final combined log has context with success flags
      expect(logs[5].context).toMatchObject({
        metaSuccess: true,
        ghstlySuccess: true,
        totalRetries: 0,
      });
    });

    it('meta failure + ghstly success produces correct mixed-status logs', async () => {
      const { persistence, logs } = createMockOrchestratorPersistence();

      const metaSync: MetaSyncFn = vi.fn(async () => {
        throw new Error('Unauthorized 401');
      });

      const ghstlySync: GhstlySyncFn = vi.fn(async () => ({
        recordsSynced: 100,
        watermarkDate: REPORT_DATE,
      }));

      const result = await runCombinedSync(
        'incremental',
        persistence,
        metaSync,
        ghstlySync,
        { maxRetries: 0 },
      );

      expect(result.metaSuccess).toBe(false);
      expect(result.ghstlySuccess).toBe(true);

      // Meta should have failed persist log
      const metaLogs = logs.filter((l) => l.source === 'meta');
      expect(metaLogs).toHaveLength(2); // fetch-running + persist-failed
      expect(metaLogs[1]).toMatchObject({
        stage: 'persist',
        status: 'failed',
        error_class: 'non-retryable',
        error_message: 'Unauthorized 401',
      });

      // Ghstly should have succeeded
      const ghstlyLogs = logs.filter((l) => l.source === 'ghstly');
      expect(ghstlyLogs[1]).toMatchObject({ stage: 'persist', status: 'success' });

      // Combined should be failed (partial failure = failed)
      const combinedFinalLog = logs.filter(
        (l) => l.source === 'combined' && l.status !== 'running',
      );
      expect(combinedFinalLog[0].status).toBe('failed');
      expect(combinedFinalLog[0].context).toMatchObject({
        metaSuccess: false,
        ghstlySuccess: true,
        metaError: 'Unauthorized 401',
      });
    });

    it('both sources fail produces combined failed with both errors in context', async () => {
      const { persistence, logs } = createMockOrchestratorPersistence();

      const metaSync: MetaSyncFn = vi.fn(async () => {
        throw new Error('Forbidden 403');
      });

      const ghstlySync: GhstlySyncFn = vi.fn(async () => {
        throw new Error('Bad request 400');
      });

      const result = await runCombinedSync(
        'incremental',
        persistence,
        metaSync,
        ghstlySync,
        { maxRetries: 0 },
      );

      expect(result.metaSuccess).toBe(false);
      expect(result.ghstlySuccess).toBe(false);
      expect(result.metaError).toContain('403');
      expect(result.ghstlyError).toContain('400');

      // Combined final log captures both errors
      const finalLog = logs[logs.length - 1];
      expect(finalLog).toMatchObject({
        source: 'combined',
        stage: 'orchestrate',
        status: 'failed',
      });
      expect(finalLog.context).toMatchObject({
        metaSuccess: false,
        ghstlySuccess: false,
        metaError: 'Forbidden 403',
        ghstlyError: 'Bad request 400',
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Integration: Orchestrator result → Combine step → Derived metrics
  // ---------------------------------------------------------------------------

  describe('combine step produces correct aggregated data from pipeline output', () => {
    it('joined rows have correct derived metrics from Meta + Ghstly data', async () => {
      const metaRow = makeMetaRow();
      const ghstlyRow = makeGhstlyRow();
      const combinePersistence = createMockCombinePersistence([metaRow], [ghstlyRow]);

      const result = await materializeCombinedStats(combinePersistence, {
        from: REPORT_DATE,
        to: REPORT_DATE,
      });

      expect(result.joinableRows).toBe(1);
      expect(result.metaOnlyRows).toBe(0);
      expect(result.ghstlyOnlyRows).toBe(0);
      expect(result.rowsUpserted).toBe(1);

      // Verify the upserted row has correct derived metrics
      const upsertedRows = vi.mocked(combinePersistence.upsertCombinedStats).mock.calls[0][0];
      const row = upsertedRows[0];

      // Source metrics pass through
      expect(row.spend).toBe(100);
      expect(row.impressions).toBe(10000);
      expect(row.visits).toBe(400);
      expect(row.chats).toBe(100);
      expect(row.reveals).toBe(40);
      expect(row.click_throughs).toBe(20);
      expect(row.ghstly_conversions).toBe(6);

      // Derived metrics computed correctly
      expect(row.chat_rate).toBe(100 / 400);               // chats / visits
      expect(row.cost_per_chat).toBe(100 / 100);            // spend / chats
      expect(row.reveal_rate).toBe(40 / 100);               // reveals / chats
      expect(row.cost_per_reveal).toBe(100 / 40);           // spend / reveals
      expect(row.reveal_click_through_rate).toBe(20 / 100);  // click_throughs / chats
      expect(row.cost_per_unique_click).toBe(100 / 160);    // spend / unique_clicks

      // Join metadata
      expect(row.join_status).toBe('joinable');
      expect(row.meta_batch_id).toBe(META_BATCH_ID);
      expect(row.ghstly_batch_id).toBe(GHSTLY_BATCH_ID);
    });

    it('multi-entity pipeline produces correct join/partial breakdown', async () => {
      const metaRows = [
        makeMetaRow({ entity_id: 'ad_both', entity_level: 'ad' }),
        makeMetaRow({ entity_id: 'ad_meta_only', entity_level: 'ad' }),
        makeMetaRow({ entity_id: 'campaign_both', entity_level: 'campaign' }),
      ];
      const ghstlyRows = [
        makeGhstlyRow({ entity_id: 'ad_both', entity_level: 'ad' }),
        makeGhstlyRow({ entity_id: 'ad_ghstly_only', entity_level: 'ad' }),
        makeGhstlyRow({ entity_id: 'campaign_both', entity_level: 'campaign' }),
      ];

      const combinePersistence = createMockCombinePersistence(metaRows, ghstlyRows);
      const result = await materializeCombinedStats(combinePersistence, {
        from: REPORT_DATE,
        to: REPORT_DATE,
      });

      // 2 joined (ad_both + campaign_both), 1 meta-only, 1 ghstly-only
      expect(result.joinableRows).toBe(2);
      expect(result.metaOnlyRows).toBe(1);
      expect(result.ghstlyOnlyRows).toBe(1);
      expect(result.rowsUpserted).toBe(4);

      // Verify the partial rows have correct null patterns
      const upsertedRows = vi.mocked(combinePersistence.upsertCombinedStats).mock.calls[0][0];

      const metaOnlyRow = upsertedRows.find(
        (r) => r.entity_id === 'ad_meta_only',
      )!;
      expect(metaOnlyRow.join_status).toBe('partial');
      expect(metaOnlyRow.spend).toBe(100);
      expect(metaOnlyRow.visits).toBeNull();
      expect(metaOnlyRow.chats).toBeNull();
      expect(metaOnlyRow.chat_rate).toBeNull();
      expect(metaOnlyRow.cost_per_chat).toBeNull();

      const ghstlyOnlyRow = upsertedRows.find(
        (r) => r.entity_id === 'ad_ghstly_only',
      )!;
      expect(ghstlyOnlyRow.join_status).toBe('partial');
      expect(ghstlyOnlyRow.spend).toBeNull();
      expect(ghstlyOnlyRow.visits).toBe(400);
      expect(ghstlyOnlyRow.cost_per_chat).toBeNull(); // no spend
      expect(ghstlyOnlyRow.chat_rate).toBe(100 / 400); // ghstly-only derived metric
    });
  });

  // ---------------------------------------------------------------------------
  // Integration: Pipeline → Freshness computation
  // ---------------------------------------------------------------------------

  describe('freshness computation after pipeline run', () => {
    /** Create a UTC Date corresponding to a specific PT hour on 2026-03-21 (PDT, UTC-7) */
    function ptDate(hour: number, minute = 0): Date {
      const utcHour = hour + 7;
      const dayOffset = Math.floor(utcHour / 24);
      const normalizedHour = utcHour % 24;
      const day = 21 + dayOffset;
      return new Date(
        `2026-03-${String(day).padStart(2, '0')}T${String(normalizedHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`,
      );
    }

    it('returns fresh when both sources completed successfully in the window', () => {
      // Simulate: both syncs completed at 6:30am PT, we evaluate at 7:30am PT
      const windowBoundary = ptDate(6, 0);
      const metaCompletedAt = new Date(windowBoundary.getTime() + 30 * 60 * 1000);
      const ghstlyCompletedAt = new Date(windowBoundary.getTime() + 35 * 60 * 1000);
      const now = ptDate(7, 30);

      const logs: FreshnessSyncLogRow[] = [
        { source: 'meta', status: 'success', completed_at: metaCompletedAt.toISOString(), stage: 'persist' },
        { source: 'ghstly', status: 'success', completed_at: ghstlyCompletedAt.toISOString(), stage: 'persist' },
      ];

      const freshness = computeFreshness(logs, now);
      expect(freshness.state).toBe('fresh');
      expect(freshness.meta.completed).toBe(true);
      expect(freshness.ghstly.completed).toBe(true);
    });

    it('returns degraded when only meta succeeded (ghstly failed)', () => {
      const windowBoundary = ptDate(6, 0);
      const metaCompletedAt = new Date(windowBoundary.getTime() + 30 * 60 * 1000);
      const now = ptDate(7, 30);

      const logs: FreshnessSyncLogRow[] = [
        { source: 'meta', status: 'success', completed_at: metaCompletedAt.toISOString(), stage: 'persist' },
        { source: 'ghstly', status: 'failed', completed_at: new Date(windowBoundary.getTime() + 30 * 60 * 1000).toISOString(), stage: 'persist' },
      ];

      const freshness = computeFreshness(logs, now);
      expect(freshness.state).toBe('degraded');
      expect(freshness.meta.completed).toBe(true);
      expect(freshness.ghstly.completed).toBe(false);
    });

    it('returns stale when both sources failed', () => {
      const windowBoundary = ptDate(6, 0);
      const now = ptDate(8, 0);

      const logs: FreshnessSyncLogRow[] = [
        { source: 'meta', status: 'failed', completed_at: new Date(windowBoundary.getTime() + 15 * 60 * 1000).toISOString(), stage: 'persist' },
        { source: 'ghstly', status: 'failed', completed_at: new Date(windowBoundary.getTime() + 20 * 60 * 1000).toISOString(), stage: 'persist' },
      ];

      const freshness = computeFreshness(logs, now);
      expect(freshness.state).toBe('stale');
      expect(freshness.meta.completed).toBe(false);
      expect(freshness.ghstly.completed).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Integration: Pipeline → Data Quality checks
  // ---------------------------------------------------------------------------

  describe('data quality checks on pipeline output', () => {
    it('healthy data passes all quality checks', () => {
      const input: QualityInput = {
        totalGhstlyRows: 100,
        unjoinableGhstlyRows: 2,  // 2% — below 5% warning threshold
        duplicateRows: 0,
        totalRows: 200,
        nullKeyMetaRows: 0,
        totalMetaRows: 100,
      };

      const checks = evaluateDataQuality(input);

      expect(checks.every((c) => c.severity === 'healthy')).toBe(true);
    });

    it('high unjoinable rate triggers warning or critical', () => {
      const input: QualityInput = {
        totalGhstlyRows: 100,
        unjoinableGhstlyRows: 30,  // 30% unjoinable
        duplicateRows: 0,
        totalRows: 200,
        nullKeyMetaRows: 0,
        totalMetaRows: 100,
      };

      const checks = evaluateDataQuality(input);
      const unmatchedCheck = checks.find((c) => c.check === 'unmatched_join_rate')!;

      expect(unmatchedCheck.severity).not.toBe('healthy');
      expect(unmatchedCheck.value).toBe(30);
    });
  });

  // ---------------------------------------------------------------------------
  // Integration: End-to-end pipeline simulation
  // ---------------------------------------------------------------------------

  describe('end-to-end: orchestrate → sync → combine → freshness', () => {
    it('simulates a complete successful pipeline run and verifies data flows between all stages', async () => {
      // ---- Stage 1: Orchestrator coordinates syncs ----
      const { persistence: orchPersistence, logs: syncLogs } = createMockOrchestratorPersistence();

      // Simulate Meta and Ghstly sync functions that return record counts
      const metaRecordsSynced = 3;
      const ghstlyRecordsSynced = 3;

      const metaSync: MetaSyncFn = vi.fn(async (_type, syncBatchId) => ({
        recordsSynced: metaRecordsSynced,
        watermarkDate: REPORT_DATE,
      }));

      const ghstlySync: GhstlySyncFn = vi.fn(async (_type, syncBatchId) => ({
        recordsSynced: ghstlyRecordsSynced,
        watermarkDate: REPORT_DATE,
      }));

      const orchResult = await runCombinedSync(
        'incremental',
        orchPersistence,
        metaSync,
        ghstlySync,
        { maxRetries: 0, triggeredBy: 'e2e-test' },
      );

      expect(orchResult.metaSuccess).toBe(true);
      expect(orchResult.ghstlySuccess).toBe(true);

      // Verify sync functions received the batch ID
      expect(metaSync).toHaveBeenCalledWith('incremental', orchResult.syncBatchId, { backfillDays: 30 });
      expect(ghstlySync).toHaveBeenCalledWith('incremental', orchResult.syncBatchId, { backfillDays: 30 });

      // ---- Stage 2: Combine step merges the data ----
      // Simulate the data that would have been written by meta-sync and ghstly-sync
      const metaRows = [
        makeMetaRow({ entity_id: 'ad_001', sync_batch_id: orchResult.syncBatchId }),
        makeMetaRow({ entity_id: 'ad_002', sync_batch_id: orchResult.syncBatchId }),
        makeMetaRow({ entity_id: 'ad_003', sync_batch_id: orchResult.syncBatchId }),
      ];
      const ghstlyRows = [
        makeGhstlyRow({ entity_id: 'ad_001', sync_batch_id: orchResult.syncBatchId }),
        makeGhstlyRow({ entity_id: 'ad_002', sync_batch_id: orchResult.syncBatchId }),
        // ad_003 has no Ghstly match (Meta-only partial)
      ];

      const combinePersistence = createMockCombinePersistence(metaRows, ghstlyRows);
      const combineResult = await materializeCombinedStats(combinePersistence, {
        from: REPORT_DATE,
        to: REPORT_DATE,
      });

      expect(combineResult.joinableRows).toBe(2);
      expect(combineResult.metaOnlyRows).toBe(1);
      expect(combineResult.rowsUpserted).toBe(3);

      // ---- Stage 3: Freshness reflects the successful sync ----
      // Build freshness logs from the orchestrator sync_logs
      const now = new Date();
      const metaSuccessLog = syncLogs.find(
        (l) => l.source === 'meta' && l.status === 'success',
      )!;
      const ghstlySuccessLog = syncLogs.find(
        (l) => l.source === 'ghstly' && l.status === 'success',
      )!;

      const freshnessLogs: FreshnessSyncLogRow[] = [
        {
          source: 'meta',
          status: 'success',
          completed_at: metaSuccessLog.completed_at!,
          stage: 'persist',
        },
        {
          source: 'ghstly',
          status: 'success',
          completed_at: ghstlySuccessLog.completed_at!,
          stage: 'persist',
        },
      ];

      const freshness = computeFreshness(freshnessLogs, now);
      // Both sources just completed, so within the current window they should be fresh
      // (unless the test runs at an exact window boundary edge case, the logs
      // have completed_at = now which is always in the current window)
      expect(freshness.meta.completed).toBe(true);
      expect(freshness.ghstly.completed).toBe(true);
      expect(freshness.state).toBe('fresh');

      // ---- Stage 4: Data quality checks on combined output ----
      const qualityInput: QualityInput = {
        totalGhstlyRows: ghstlyRows.length,
        unjoinableGhstlyRows: 0,
        duplicateRows: 0,
        totalRows: combineResult.rowsUpserted,
        nullKeyMetaRows: 0,
        totalMetaRows: metaRows.length,
      };

      const qualityChecks = evaluateDataQuality(qualityInput);
      expect(qualityChecks.every((c) => c.severity === 'healthy')).toBe(true);
    });

    it('simulates a partial failure pipeline and verifies degraded state', async () => {
      // ---- Stage 1: Orchestrator — meta fails, ghstly succeeds ----
      const { persistence: orchPersistence, logs: syncLogs } = createMockOrchestratorPersistence();

      const metaSync: MetaSyncFn = vi.fn(async () => {
        throw new Error('Server error 500');
      });

      const ghstlySync: GhstlySyncFn = vi.fn(async () => ({
        recordsSynced: 50,
        watermarkDate: REPORT_DATE,
      }));

      const orchResult = await runCombinedSync(
        'incremental',
        orchPersistence,
        metaSync,
        ghstlySync,
        { maxRetries: 0 },
      );

      expect(orchResult.metaSuccess).toBe(false);
      expect(orchResult.ghstlySuccess).toBe(true);

      // ---- Stage 2: Combine still runs with whatever data is available ----
      // Only Ghstly data available (Meta sync failed, no new Meta rows)
      const ghstlyRows = [
        makeGhstlyRow({ entity_id: 'ad_001' }),
        makeGhstlyRow({ entity_id: 'ad_002' }),
      ];
      const combinePersistence = createMockCombinePersistence([], ghstlyRows);
      const combineResult = await materializeCombinedStats(combinePersistence, {
        from: REPORT_DATE,
        to: REPORT_DATE,
      });

      // All Ghstly rows are partial (no Meta match)
      expect(combineResult.ghstlyOnlyRows).toBe(2);
      expect(combineResult.joinableRows).toBe(0);
      expect(combineResult.metaOnlyRows).toBe(0);

      // Verify partial rows have null spend-dependent metrics
      const upsertedRows = vi.mocked(combinePersistence.upsertCombinedStats).mock.calls[0][0];
      for (const row of upsertedRows) {
        expect(row.spend).toBeNull();
        expect(row.cost_per_chat).toBeNull();
        expect(row.cost_per_reveal).toBeNull();
        // Ghstly-only derived metrics still computed
        expect(row.chat_rate).toBe(100 / 400);
        expect(row.reveal_rate).toBe(40 / 100);
      }

      // ---- Stage 3: Freshness is degraded (only ghstly succeeded) ----
      const ghstlySuccessLog = syncLogs.find(
        (l) => l.source === 'ghstly' && l.status === 'success',
      )!;

      const freshnessLogs: FreshnessSyncLogRow[] = [
        {
          source: 'ghstly',
          status: 'success',
          completed_at: ghstlySuccessLog.completed_at!,
          stage: 'persist',
        },
      ];

      const freshness = computeFreshness(freshnessLogs, new Date());
      expect(freshness.ghstly.completed).toBe(true);
      expect(freshness.meta.completed).toBe(false);
      expect(freshness.state).toBe('degraded');
    });
  });

  // ---------------------------------------------------------------------------
  // Integration: Backfill pipeline
  // ---------------------------------------------------------------------------

  describe('backfill pipeline', () => {
    it('passes backfill type and custom days through entire pipeline', async () => {
      const { persistence } = createMockOrchestratorPersistence();

      const metaSync: MetaSyncFn = vi.fn(async () => ({
        recordsSynced: 200,
        watermarkDate: '2026-02-19',
      }));

      const ghstlySync: GhstlySyncFn = vi.fn(async () => ({
        recordsSynced: 500,
        watermarkDate: '2026-02-19',
      }));

      const result = await runCombinedSync(
        'backfill',
        persistence,
        metaSync,
        ghstlySync,
        { maxRetries: 0, backfillDays: 60 },
      );

      expect(result.type).toBe('backfill');
      expect(result.metaSuccess).toBe(true);
      expect(result.ghstlySuccess).toBe(true);

      // Verify backfill params passed to sync functions
      expect(metaSync).toHaveBeenCalledWith('backfill', result.syncBatchId, { backfillDays: 60 });
      expect(ghstlySync).toHaveBeenCalledWith('backfill', result.syncBatchId, { backfillDays: 60 });
    });
  });

  // ---------------------------------------------------------------------------
  // Integration: Deduplication lock
  // ---------------------------------------------------------------------------

  describe('deduplication lock prevents concurrent pipeline runs', () => {
    it('skips entire pipeline when lock is held, produces skipped log', async () => {
      const now = new Date();
      const recentLock = {
        sync_batch_id: 'existing-sync-123',
        started_at: new Date(now.getTime() - 3 * 60 * 1000).toISOString(), // 3 min ago
      };
      const { persistence, logs } = createMockOrchestratorPersistence(recentLock);

      const metaSync: MetaSyncFn = vi.fn(async () => ({ recordsSynced: 0 }));
      const ghstlySync: GhstlySyncFn = vi.fn(async () => ({ recordsSynced: 0 }));

      const result = await runCombinedSync(
        'incremental',
        persistence,
        metaSync,
        ghstlySync,
      );

      // Neither sync function should have been called
      expect(metaSync).not.toHaveBeenCalled();
      expect(ghstlySync).not.toHaveBeenCalled();

      // Result indicates skip
      expect(result.metaSuccess).toBe(false);
      expect(result.ghstlySuccess).toBe(false);
      expect(result.metaError).toContain('another sync is running');

      // Only 1 log entry: skipped
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        source: 'combined',
        stage: 'orchestrate',
        status: 'skipped',
        error_class: 'DeduplicationLock',
      });
      expect(logs[0].error_message).toContain('existing-sync-123');
    });

    it('proceeds when lock is stale (>15 min)', async () => {
      const now = new Date();
      const staleLock = {
        sync_batch_id: 'stale-sync-456',
        started_at: new Date(now.getTime() - 16 * 60 * 1000).toISOString(), // 16 min ago
      };
      const { persistence } = createMockOrchestratorPersistence(staleLock);

      const metaSync: MetaSyncFn = vi.fn(async () => ({ recordsSynced: 10, watermarkDate: REPORT_DATE }));
      const ghstlySync: GhstlySyncFn = vi.fn(async () => ({ recordsSynced: 20, watermarkDate: REPORT_DATE }));

      const result = await runCombinedSync(
        'incremental',
        persistence,
        metaSync,
        ghstlySync,
        { maxRetries: 0 },
      );

      expect(result.metaSuccess).toBe(true);
      expect(result.ghstlySuccess).toBe(true);
      expect(metaSync).toHaveBeenCalledTimes(1);
      expect(ghstlySync).toHaveBeenCalledTimes(1);
    });
  });
});
