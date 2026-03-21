/**
 * POST /api/sync — Manual combined sync trigger (admin-only)
 *
 * Triggers a combined Meta + Ghstly sync. Only accessible to admin users.
 * Uses the sync orchestrator with deduplication lock.
 */

import { createClient } from '@supabase/supabase-js';
import { getServerEnv } from '@/lib/env';
import { isAdminEmail } from '@/lib/auth/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
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
  const serviceClient = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

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
    const { syncGhstlyIncremental, syncGhstlyBackfill } = await import('@/lib/sync/ghstly-sync');
    const { GhstlyClient } = await import('@/lib/api/ghstly-client');
    const client = new GhstlyClient({ baseUrl: 'https://ghstly.chat/api/partner', apiKey: env.ghstlyPartnerApiKey });
    const ghstlyPersistence = {
      async upsertDailyGhstlyStats(rows: unknown[]) {
        if ((rows as unknown[]).length === 0) return;
        const { error } = await serviceClient
          .from('daily_ghstly_stats')
          .upsert(rows as Record<string, unknown>[], { onConflict: 'date,ad_id', ignoreDuplicates: false });
        if (error) throw new Error(`Failed to upsert daily_ghstly_stats: ${error.message}`);
      },
      async upsertSessions(rows: unknown[]) {
        if ((rows as unknown[]).length === 0) return;
        const { error } = await serviceClient
          .from('sessions')
          .upsert(rows as Record<string, unknown>[], { onConflict: 'session_id', ignoreDuplicates: false });
        if (error) throw new Error(`Failed to upsert sessions: ${error.message}`);
      },
      async insertSyncLog(entry: unknown) {
        const { error } = await serviceClient.from('sync_logs').insert(entry as Record<string, unknown>);
        if (error) console.error('Failed to insert ghstly sync_log:', error.message);
      },
    };
    const result = syncType === 'backfill'
      ? await syncGhstlyBackfill(client, ghstlyPersistence, backfillDays)
      : await syncGhstlyIncremental(client, ghstlyPersistence);
    return { recordsSynced: result.dailyStatsRows.length + result.sessionRows.length };
  };

  return { persistence, metaSyncFn, ghstlySyncFn };
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

  if (authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const env = getServerEnv();
  const { persistence, metaSyncFn, ghstlySyncFn } = buildSyncDeps(env, 'incremental', 0);

  try {
    const result = await runCombinedSync('incremental', persistence, metaSyncFn, ghstlySyncFn, {
      triggeredBy: 'vercel-cron',
    });
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

  // --- Parse request body ---
  let syncType: SyncType = 'incremental';
  let backfillDays = 30;

  try {
    const body = await request.json();
    if (body.type === 'backfill') syncType = 'backfill';
    if (typeof body.backfillDays === 'number') backfillDays = body.backfillDays;
  } catch {
    // No body or invalid JSON — use defaults
  }

  // --- Build shared sync dependencies ---
  const { persistence, metaSyncFn, ghstlySyncFn } = buildSyncDeps(env, syncType, backfillDays);

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

    const status = result.metaSuccess && result.ghstlySuccess ? 200 : 207;
    return Response.json(result, { status });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}
