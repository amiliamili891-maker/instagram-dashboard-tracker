/**
 * /dashboard/sync — Sync History Page
 *
 * Shows sync history from sync_logs table with source-level
 * success/failure details and a freshness badge in the header.
 *
 * Auth is handled by the dashboard layout (requireAdminUser).
 */

import { createClient } from '@supabase/supabase-js';
import { getServerEnv } from '@/lib/env';
import { computeFreshness, type SyncLogRow } from '@/lib/sync/freshness';
import { SyncNowButton } from '@/components/sync-now-button';

export const dynamic = 'force-dynamic';

function FreshnessBadge({ state }: { state: string }) {
  const colors: Record<string, string> = {
    fresh: 'badge-fresh',
    degraded: 'badge-degraded',
    stale: 'badge-stale',
  };

  return (
    <span className={`freshness-badge ${colors[state] ?? 'badge-stale'}`}>
      {state.toUpperCase()}
    </span>
  );
}

function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('en-US', {
      timeZone: 'America/Los_Angeles',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

interface SyncLogDisplay {
  sync_batch_id: string;
  source: string;
  stage: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  records_synced: number | null;
  error_class: string | null;
  error_message: string | null;
  sync_type: string | null;
  triggered_by: string | null;
}

export default async function SyncHistoryPage() {
  const env = getServerEnv();
  const serviceClient = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Fetch last 50 sync log entries
  const { data: rawLogs, error } = await serviceClient
    .from('sync_logs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(50);

  const logs: SyncLogDisplay[] = (rawLogs ?? []) as SyncLogDisplay[];

  // Compute freshness from recent logs
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const recentLogs: SyncLogRow[] = logs
    .filter((l) => l.started_at >= oneDayAgo)
    .map((l) => ({
      source: l.source,
      status: l.status,
      completed_at: l.completed_at,
      stage: l.stage,
    }));

  const freshness = computeFreshness(recentLogs);

  return (
    <section className="sync-history">
      <header className="sync-header">
        <div className="sync-header-top">
          <h1>Sync History</h1>
          <SyncNowButton />
        </div>
        <div className="freshness-info">
          <FreshnessBadge state={freshness.state} />
          <span className="data-as-of">
            Meta: {freshness.meta.lastSuccessAt ? formatTimestamp(freshness.meta.lastSuccessAt) : 'never'}
            {' | '}
            Ghstly: {freshness.ghstly.lastSuccessAt ? formatTimestamp(freshness.ghstly.lastSuccessAt) : 'never'}
          </span>
        </div>
      </header>

      {error && (
        <div className="error-banner">
          Failed to load sync logs: {error.message}
        </div>
      )}

      {logs.length === 0 && !error && (
        <p className="empty-state">No sync history yet.</p>
      )}

      {logs.length > 0 && (
        <table className="sync-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Source</th>
              <th>Stage</th>
              <th>Status</th>
              <th>Duration</th>
              <th>Records</th>
              <th>Type</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log, i) => (
              <tr key={`${log.sync_batch_id}-${log.source}-${log.stage}-${i}`}
                  className={`status-${log.status}`}>
                <td>{formatTimestamp(log.started_at)}</td>
                <td>{log.source}</td>
                <td>{log.stage}</td>
                <td>
                  <span className={`status-badge status-${log.status}`}>
                    {log.status}
                  </span>
                </td>
                <td>{formatDuration(log.duration_ms)}</td>
                <td>{log.records_synced ?? '-'}</td>
                <td>{log.sync_type ?? '-'}</td>
                <td className="error-cell">
                  {log.error_message
                    ? `${log.error_class ?? 'Error'}: ${log.error_message.slice(0, 100)}`
                    : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
