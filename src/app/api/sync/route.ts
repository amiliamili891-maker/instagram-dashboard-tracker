/**
 * POST /api/sync — Manual combined sync trigger (admin-only)
 * GET  /api/sync — Vercel Cron handler (4x daily)
 *
 * Triggers a combined Meta + Ghstly sync, materializes combined stats,
 * then runs the intelligence pass (anomalies, tiers, mismatches, budget).
 */

import { timingSafeEqual } from 'crypto';
import { materializeCombinedStats } from '@/lib/sync/combine';
import { getServerEnv } from '@/lib/env';
import { isAdminEmail } from '@/lib/auth/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import {
  runCombinedSync,
  type SyncType,
} from '@/lib/sync/orchestrator';
import {
  createOrchestratorPersistence,
  createGhstlyPersistence,
  createCombinePersistence,
} from '@/lib/sync/persistence-adapters';
import { runIntelligencePass } from '@/lib/intelligence/run-all';

export const dynamic = 'force-dynamic';
export const maxDuration = 120; // Sync needs time for Meta + Ghstly API calls

/**
 * Build shared sync dependencies from server env.
 */
function buildSyncDeps(env: ReturnType<typeof getServerEnv>, syncType: SyncType, backfillDays: number) {
  const serviceClient = createServiceClient();
  const persistence = createOrchestratorPersistence(serviceClient);

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
    console.log(`[ghstly-sync] Client created with base URL: ${process.env.GHSTLY_PARTNER_API_URL}`);
    const ghstlyPersistence = createGhstlyPersistence(serviceClient);
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
 * Run the combine step then the intelligence pass.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runPostSyncPipeline(serviceClient: any, backfillDays: number) {
  // --- Combine step ---
  const now = new Date();
  const to = now.toISOString().split('T')[0];
  const daysBack = backfillDays > 0 ? backfillDays : 2;
  const from = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const combinePersistence = createCombinePersistence(serviceClient);

  try {
    const combineResult = await materializeCombinedStats(combinePersistence, { from, to });
    console.log(
      `Combined stats materialized: ${combineResult.rowsUpserted} rows (${combineResult.joinableRows} joinable, ${combineResult.metaOnlyRows} meta-only)`,
    );
  } catch (err) {
    console.error('Combine step failed:', err);
    // Don't block intelligence pass — it can still run on stale combined data
  }

  // --- Intelligence pass (non-blocking) ---
  try {
    const intelligenceResult = await runIntelligencePass(serviceClient);
    if (intelligenceResult.errors.length > 0) {
      console.warn(
        `[intelligence] ${intelligenceResult.errors.length} module(s) failed:`,
        intelligenceResult.errors,
      );
    }
  } catch (err) {
    // Intelligence failures must never fail the sync response
    console.error('[intelligence] Pass failed entirely:', err);
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

    await runPostSyncPipeline(serviceClient, 2);

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

    await runPostSyncPipeline(serviceClient, syncType === 'backfill' ? backfillDays : 2);

    const status = result.metaSuccess && result.ghstlySuccess ? 200 : 207;
    return Response.json(result, { status });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}
