/**
 * POST /api/sync — Manual combined sync trigger (admin-only)
 *
 * Triggers a combined Meta + Ghstly sync. Only accessible to admin users.
 * Uses the sync orchestrator with deduplication lock.
 */

import { timingSafeEqual } from 'crypto';
import { materializeCombinedStats, type CombinePersistence } from '@/lib/sync/combine';
import { getServerEnv } from '@/lib/env';
import { isAdminEmail } from '@/lib/auth/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import {
  runCombinedSync,
  type OrchestratorPersistence,
  type OrchestratorSyncLog,
  type SyncType,
} from '@/lib/sync/orchestrator';

export const dynamic = 'force-dynamic';
export const maxDuration = 120; // Sync needs time for Meta + Ghstly API calls

/**
 * Build shared sync dependencies from server env.
 * Used by both POST (manual) and GET (cron) handlers.
 */
function buildSyncDeps(env: ReturnType<typeof getServerEnv>, syncType: SyncType, backfillDays: number) {
  const serviceClient = createServiceClient();

  const persistence: OrchestratorPersistence = {
    async insertSyncLog(entry: OrchestratorSyncLog): Promise<void> {
      const { error } = await serviceClient.from('sync_logs').insert(entry);
      if (error) console.error('Failed to insert sync_log:', error.message);
    },
    async findRunningSync() {
      const { data, error } = await serviceClient
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

  const metaSyncFn = async () => {
    const { syncMetaIncremental, syncMetaBackfill } = await import('@/lib/sync/meta-sync');
    const config = {
      supabaseUrl: env.supabaseUrl,
      supabaseServiceRoleKey: env.supabaseServiceRoleKey,
      metaAccessToken: env.metaAccessToken,
      metaAdAccountId: env.metaAdAccountId,
    };
    const result = syncType === 'backfill'
      ? await syncMetaBackfill(config, backfillDays)
      : await syncMetaIncremental(config);
    return {
      recordsSynced: result.campaignsUpserted + result.adsetsUpserted + result.adsUpserted + result.insightsUpserted,
      watermarkDate: result.dateRange.until,
    };
  };

  const ghstlySyncFn = async () => {
    console.log('[ghstly-sync] Starting Ghstly sync...');
    const { syncGhstlyIncremental, syncGhstlyBackfill } = await import('@/lib/sync/ghstly-sync');
    const { GhstlyClient } = await import('@/lib/api/ghstly-client');
    const client = GhstlyClient.fromEnv();
    console.log(`[ghstly-sync] Client created with base URL: ${process.env.GHSTLY_PARTNER_API_URL || 'default (148.251.46.108:8400)'}`);
    const ghstlyPersistence = {
      async upsertDailyGhstlyStats(rows: unknown[]) {
        if ((rows as unknown[]).length === 0) return;
        const { error } = await serviceClient
          .from('daily_ghstly_stats')
          .upsert(rows as Record<string, unknown>[], { onConflict: 'report_date,entity_level,entity_id', ignoreDuplicates: false });
        if (error) throw new Error(`Failed to upsert daily_ghstly_stats: ${error.message}`);
      },
      async upsertSessions(rows: unknown[]) {
        if ((rows as unknown[]).length === 0) return;
        const { error } = await serviceClient
          .from('sessions')
          .upsert(rows as Record<string, unknown>[], { onConflict: 'id', ignoreDuplicates: false });
        if (error) throw new Error(`Failed to upsert sessions: ${error.message}`);
      },
      async insertSyncLog(entry: unknown) {
        const { error } = await serviceClient.from('sync_logs').insert(entry as Record<string, unknown>);
        if (error) console.error('Failed to insert ghstly sync_log:', error.message);
      },
      async getLatestSessionTimestamp(): Promise<string | null> {
        const { data } = await serviceClient
          .from('sessions')
          .select('created_at_utc')
          .order('created_at_utc', { ascending: false })
          .limit(1)
          .single();
        return data?.created_at_utc ?? null;
      },
    };
    try {
      const result = syncType === 'backfill'
        ? await syncGhstlyBackfill(client, ghstlyPersistence, backfillDays)
        : await syncGhstlyIncremental(client, ghstlyPersistence);
      console.log(`[ghstly-sync] Success: ${result.dailyStatsRows.length} stats rows, ${result.sessionRows.length} session rows`);
      return { recordsSynced: result.dailyStatsRows.length + result.sessionRows.length };
    } catch (err) {
      console.error('[ghstly-sync] Failed:', err);
      throw err;
    }
  };

  return { persistence, metaSyncFn, ghstlySyncFn, serviceClient };
}

/**
 * Run the combine step after sync completes.
 * Materializes daily_combined_stats from Meta + Ghstly source tables.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runCombineStep(serviceClient: any, backfillDays: number) {
  // materializeCombinedStats and CombinePersistence imported at top level

  // Date range: from backfillDays ago (or 2 days for incremental) to today
  const now = new Date();
  const to = now.toISOString().split('T')[0];
  const daysBack = backfillDays > 0 ? backfillDays : 2;
  const from = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const combinePersistence: CombinePersistence = {
    async fetchMetaStats(dateRange) {
      const { data } = await serviceClient
        .from('daily_meta_stats')
        .select('*')
        .gte('report_date', dateRange.from)
        .lte('report_date', dateRange.to);
      return data ?? [];
    },
    async fetchGhstlyStats(dateRange) {
      const { data } = await serviceClient
        .from('daily_ghstly_stats')
        .select('*')
        .gte('report_date', dateRange.from)
        .lte('report_date', dateRange.to);
      return data ?? [];
    },
    async fetchSyncLogs(batchIds) {
      if (batchIds.length === 0) return [];
      const { data } = await serviceClient
        .from('sync_logs')
        .select('sync_batch_id, source, status, completed_at')
        .in('sync_batch_id', batchIds);
      return data ?? [];
    },
    async upsertCombinedStats(rows) {
      if (rows.length === 0) return 0;
      const { error } = await serviceClient
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

  try {
    const result = await materializeCombinedStats(combinePersistence, { from, to });
    console.log(`Combined stats materialized: ${result.rowsUpserted} rows (${result.joinableRows} joinable, ${result.metaOnlyRows} meta-only)`);
    return result;
  } catch (err) {
    console.error('Combine step failed:', err);
    return null;
  }
}

/**
 * GET /api/sync — Vercel Cron handler (4x daily)
 * Authenticated via CRON_SECRET bearer token.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error('CRON_SECRET not configured');
    return Response.json({ error: 'Server misconfiguration' }, { status: 500 });
  }

  const expected = Buffer.from(`Bearer ${cronSecret}`);
  const received = Buffer.from(authHeader ?? '');
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const env = getServerEnv();
  const { persistence, metaSyncFn, ghstlySyncFn, serviceClient } = buildSyncDeps(env, 'incremental', 0);

  try {
    const result = await runCombinedSync('incremental', persistence, metaSyncFn, ghstlySyncFn, {
      triggeredBy: 'vercel-cron',
    });

    // Materialize combined stats after sync
    await runCombineStep(serviceClient, 2);

    const status = result.metaSuccess && result.ghstlySuccess ? 200 : 207;
    return Response.json(result, { status });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  // --- Admin guard ---
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user?.email) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const env = getServerEnv();
  if (!isAdminEmail(user.email, env.adminEmail)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  // --- Cooldown check: reject if a sync completed within last 5 minutes ---
  const cooldownClient = createServiceClient();
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: recentSync } = await cooldownClient
    .from('sync_logs')
    .select('completed_at')
    .eq('source', 'combined')
    .eq('stage', 'orchestrate')
    .eq('status', 'success')
    .gte('completed_at', fiveMinAgo)
    .order('completed_at', { ascending: false })
    .limit(1);

  if (recentSync && recentSync.length > 0) {
    const lastCompleted = new Date(recentSync[0].completed_at);
    const nextAllowed = new Date(lastCompleted.getTime() + 5 * 60 * 1000);
    return Response.json(
      {
        error: 'Sync cooldown active',
        message: `A sync completed at ${lastCompleted.toISOString()}. Next sync allowed after ${nextAllowed.toISOString()}.`,
      },
      { status: 429 },
    );
  }

  // --- Parse request body ---
  let syncType: SyncType = 'incremental';
  let backfillDays = 30;

  try {
    const body = await request.json();
    if (body.type === 'backfill') syncType = 'backfill';
    if (typeof body.backfillDays === 'number') backfillDays = Math.min(Math.max(body.backfillDays, 1), 90);
  } catch {
    // No body or invalid JSON — use defaults
  }

  // --- Build shared sync dependencies ---
  const { persistence, metaSyncFn, ghstlySyncFn, serviceClient } = buildSyncDeps(env, syncType, backfillDays);

  // --- Run the combined sync ---
  try {
    const result = await runCombinedSync(
      syncType,
      persistence,
      metaSyncFn,
      ghstlySyncFn,
      {
        triggeredBy: user.email,
        backfillDays,
      },
    );

    // Materialize combined stats after sync
    await runCombineStep(serviceClient, syncType === 'backfill' ? backfillDays : 2);

    const status = result.metaSuccess && result.ghstlySuccess ? 200 : 207;
    return Response.json(result, { status });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}
