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

/**
 * Comprehensive sync_logs row — superset of all fields used across modules.
 * Modules that only need a subset should use Pick<SyncLogRow, ...>.
 */
export interface SyncLogRow {
  sync_batch_id: string;
  source: string;
  stage: string;
  status: string;
  started_at: string;
  completed_at: string | null;
}

/** Date range used across sync modules (combine, reconciliation, etc.) */
export interface DateRange {
  from: string;
  to: string;
}
