/**
 * GET /api/sync/status — Returns freshness state and sync status
 *
 * Public endpoint (no admin guard) — used by the dashboard to show
 * freshness badges and "data as of" timestamps.
 */

import { createClient } from '@supabase/supabase-js';
import { getServerEnv } from '@/lib/env';
import { computeFreshness, type SyncLogRow } from '@/lib/sync/freshness';

export const dynamic = 'force-dynamic';

export async function GET() {
  const env = getServerEnv();
  const serviceClient = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Fetch recent sync logs (last 24 hours should be more than enough)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: logs, error } = await serviceClient
    .from('sync_logs')
    .select('source, status, completed_at, stage')
    .gte('started_at', oneDayAgo)
    .order('started_at', { ascending: false });

  if (error) {
    return Response.json(
      { error: `Failed to fetch sync logs: ${error.message}` },
      { status: 500 },
    );
  }

  const syncLogs: SyncLogRow[] = (logs ?? []).map((row) => ({
    source: row.source,
    status: row.status,
    completed_at: row.completed_at,
    stage: row.stage,
  }));

  // Compute freshness
  const freshness = computeFreshness(syncLogs);

  // Check if a sync is currently running
  const { data: runningLogs } = await serviceClient
    .from('sync_logs')
    .select('sync_batch_id, started_at, source')
    .eq('source', 'combined')
    .eq('stage', 'orchestrate')
    .eq('status', 'running')
    .order('started_at', { ascending: false })
    .limit(1);

  const isRunning = (runningLogs ?? []).length > 0;
  const runningSyncId = isRunning ? runningLogs![0].sync_batch_id : null;

  return Response.json({
    freshness,
    isRunning,
    runningSyncId,
  });
}
