/**
 * Shared types for the sync subsystem.
 *
 * Canonical SyncLogEntry definition — all sync modules (meta-sync, ghstly-sync)
 * should import from here instead of defining their own.
 */

/** A row in the sync_logs table. */
export interface SyncLogEntry {
  sync_batch_id: string;
  source: 'meta' | 'ghstly' | 'combined';
  stage: string;
  status: 'running' | 'success' | 'failed' | 'error' | 'skipped';
  started_at: string;
  completed_at?: string;
  duration_ms?: number;
  records_synced?: number;
  watermark_date?: string | null;
  error_class?: string | null;
  error_message?: string | null;
  context?: Record<string, unknown>;
  sync_type?: string;
  triggered_by?: string;
}
