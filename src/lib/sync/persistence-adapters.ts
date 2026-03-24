/**
 * Supabase persistence adapters for the sync pipeline.
 *
 * Extracted from the sync route to keep the route handler thin and
 * make the adapters reusable / testable in isolation.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrchestratorPersistence, OrchestratorSyncLog } from './orchestrator';
import type { GhstlyPersistence, DailyGhstlyStatsRow, SessionRow } from './ghstly-sync';
import type { SyncLogEntry } from './types';
import type { CombinePersistence, DateRange, CombinedStatsRow } from './combine';

// ---------------------------------------------------------------------------
// Orchestrator Persistence
// ---------------------------------------------------------------------------

export function createOrchestratorPersistence(
  client: SupabaseClient,
): OrchestratorPersistence {
  return {
    async insertSyncLog(entry: OrchestratorSyncLog): Promise<void> {
      const { error } = await client.from('sync_logs').insert(entry);
      if (error) console.error('Failed to insert sync_log:', error.message);
    },

    async findRunningSync() {
      const { data, error } = await client
        .from('sync_logs')
        .select('sync_batch_id, started_at')
        .eq('source', 'combined')
        .eq('stage', 'orchestrate')
        .eq('status', 'running')
        .order('started_at', { ascending: false })
        .limit(1);
      if (error || !data || data.length === 0) return null;
      return data[0];
    },
  };
}

// ---------------------------------------------------------------------------
// Ghstly Persistence
// ---------------------------------------------------------------------------

export function createGhstlyPersistence(
  client: SupabaseClient,
): GhstlyPersistence {
  return {
    async upsertDailyGhstlyStats(rows: DailyGhstlyStatsRow[]): Promise<void> {
      if (rows.length === 0) return;
      const { error } = await client
        .from('daily_ghstly_stats')
        .upsert(rows as unknown as Record<string, unknown>[], {
          onConflict: 'report_date,entity_level,entity_id',
          ignoreDuplicates: false,
        });
      if (error)
        throw new Error(`Failed to upsert daily_ghstly_stats: ${error.message}`);
    },

    async upsertSessions(rows: SessionRow[]): Promise<void> {
      if (rows.length === 0) return;
      const { error } = await client
        .from('sessions')
        .upsert(rows as unknown as Record<string, unknown>[], {
          onConflict: 'id',
          ignoreDuplicates: false,
        });
      if (error)
        throw new Error(`Failed to upsert sessions: ${error.message}`);
    },

    async insertSyncLog(entry: SyncLogEntry): Promise<void> {
      const { error } = await client
        .from('sync_logs')
        .insert(entry as unknown as Record<string, unknown>);
      if (error) console.error('Failed to insert ghstly sync_log:', error.message);
    },

    async getLatestSessionTimestamp(): Promise<string | null> {
      const { data } = await client
        .from('sessions')
        .select('created_at_utc')
        .order('created_at_utc', { ascending: false })
        .limit(1)
        .single();
      return data?.created_at_utc ?? null;
    },
  };
}

// ---------------------------------------------------------------------------
// Combine Persistence
// ---------------------------------------------------------------------------

export function createCombinePersistence(
  client: SupabaseClient,
): CombinePersistence {
  return {
    async fetchMetaStats(dateRange: DateRange) {
      const { data } = await client
        .from('daily_meta_stats')
        .select('report_date, entity_level, entity_id, campaign_id, adset_id, ad_id, spend, impressions, clicks, unique_clicks, cpc, cpm, ctr, meta_conversions, cost_per_action, sync_batch_id')
        .gte('report_date', dateRange.from)
        .lte('report_date', dateRange.to);
      return data ?? [];
    },

    async fetchGhstlyStats(dateRange: DateRange) {
      const { data } = await client
        .from('daily_ghstly_stats')
        .select('report_date, entity_level, entity_id, campaign_id, adset_id, ad_id, visits, chats, reveals, click_throughs, ghstly_conversions, join_status, join_issue, sync_batch_id')
        .gte('report_date', dateRange.from)
        .lte('report_date', dateRange.to);
      return data ?? [];
    },

    async fetchSyncLogs(batchIds: string[]) {
      if (batchIds.length === 0) return [];
      const { data } = await client
        .from('sync_logs')
        .select('sync_batch_id, source, stage, status, started_at, completed_at')
        .in('sync_batch_id', batchIds);
      return data ?? [];
    },

    async upsertCombinedStats(rows: CombinedStatsRow[]) {
      if (rows.length === 0) return 0;
      const { error } = await client
        .from('daily_combined_stats')
        .upsert(rows as unknown as Record<string, unknown>[], {
          onConflict: 'report_date,entity_level,entity_id',
          ignoreDuplicates: false,
        });
      if (error) {
        console.error('Failed to upsert combined stats:', error.message);
        return 0;
      }
      return rows.length;
    },
  };
}
