/**
 * GET /api/sync/status — Returns freshness state and sync status
 *
 * Public endpoint (no admin guard) — used by the dashboard to show
 * freshness badges and "data as of" timestamps.
 */

import { createServiceClient } from '@/lib/supabase/service';
import { computeFreshness, type SyncLogRow } from '@/lib/sync/freshness';

export const dynamic = 'force-dynamic';

export async function GET() {
  const serviceClient = createServiceClient();

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
  // Look for the latest combined orchestrate row — if it's "running" AND
  // no completed row exists for the same batch, the sync is truly active.
  const { data: latestOrchestrate } = await serviceClient
    .from('sync_logs')
    .select('sync_batch_id, status')
    .eq('source', 'combined')
    .eq('stage', 'orchestrate')
    .order('started_at', { ascending: false })
    .limit(2);

  let isRunning = false;
  let runningSyncId: string | null = null;

  if (latestOrchestrate && latestOrchestrate.length > 0) {
    const latest = latestOrchestrate[0];
    if (latest.status === 'running') {
      // Check if there's a completed row for the same batch (orchestrator inserts both)
      const hasCompleted = latestOrchestrate.some(
        (r) => r.sync_batch_id === latest.sync_batch_id && r.status !== 'running',
      );
      if (!hasCompleted) {
        // Also check beyond the last 2 rows
        const { data: completedCheck } = await serviceClient
          .from('sync_logs')
          .select('sync_batch_id')
          .eq('source', 'combined')
          .eq('stage', 'orchestrate')
          .eq('sync_batch_id', latest.sync_batch_id)
          .in('status', ['success', 'failed'])
          .limit(1);
        isRunning = (completedCheck ?? []).length === 0;
        runningSyncId = isRunning ? latest.sync_batch_id : null;
      }
    }
  }

  return Response.json({
    freshness,
    isRunning,
    runningSyncId,
  });
}
