/**
 * Sync Orchestrator
 *
 * Runs Meta and Ghstly syncs in sequence with:
 *   - Shared sync_batch_id for the combined run
 *   - Stage-level status tracking: fetch → persist → derive
 *   - Deduplication lock via sync_logs (stale-lock recovery after 10 min)
 *   - Retry classification: retryable (429, 5xx, network) vs non-retryable (401, 400, schema)
 *   - Exponential backoff for retryable failures only
 *   - Full logging to sync_logs table
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SyncType = 'incremental' | 'backfill';
export type SyncStage = 'orchestrate' | 'fetch' | 'persist' | 'derive';
export type SyncStatus = 'running' | 'success' | 'failed' | 'skipped';

export interface OrchestratorSyncLog {
  sync_batch_id: string;
  source: 'combined' | 'meta' | 'ghstly';
  stage: SyncStage;
  status: SyncStatus;
  started_at: string;
  completed_at?: string;
  duration_ms?: number;
  records_synced?: number;
  watermark_date?: string;
  error_class?: string;
  error_message?: string;
  context?: Record<string, unknown>;
  sync_type?: string;
  triggered_by?: string;
}

export interface CombinedSyncResult {
  syncBatchId: string;
  type: SyncType;
  metaSuccess: boolean;
  ghstlySuccess: boolean;
  metaError?: string;
  ghstlyError?: string;
  durationMs: number;
  /** Number of retries attempted across both sources */
  totalRetries: number;
}

export interface CombinedSyncOptions {
  /** Who triggered this sync */
  triggeredBy?: string;
  /** Days for backfill (default 30) */
  backfillDays?: number;
  /** Maximum retries for retryable errors (default 3) */
  maxRetries?: number;
}

/** Interface for the Meta sync function */
export type MetaSyncFn = (type: SyncType, syncBatchId: string, options?: {
  backfillDays?: number;
}) => Promise<{ recordsSynced: number; watermarkDate?: string }>;

/** Interface for the Ghstly sync function */
export type GhstlySyncFn = (type: SyncType, syncBatchId: string, options?: {
  backfillDays?: number;
}) => Promise<{ recordsSynced: number; watermarkDate?: string }>;

/** Persistence interface for the orchestrator */
export interface OrchestratorPersistence {
  insertSyncLog(entry: OrchestratorSyncLog): Promise<void>;
  /** Check if there is a running sync (returns the log row or null) */
  findRunningSync(): Promise<{ sync_batch_id: string; started_at: string } | null>;
}

// ---------------------------------------------------------------------------
// Error Classification
// ---------------------------------------------------------------------------

/** HTTP status codes and error types that are retryable */
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

/** Error message patterns that indicate retryable failures */
const RETRYABLE_PATTERNS = [
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /ETIMEDOUT/i,
  /ENOTFOUND/i,
  /network/i,
  /timeout/i,
  /socket hang up/i,
  /fetch failed/i,
  /rate.?limit/i,
];

/** HTTP status codes that are definitively non-retryable */
const NON_RETRYABLE_STATUS_CODES = new Set([400, 401, 403, 404, 422]);

export type ErrorClassification = 'retryable' | 'non-retryable';

/**
 * Classify an error as retryable or non-retryable.
 *
 * Retryable: 429, 5xx, network errors (ECONNRESET, ETIMEDOUT, etc.)
 * Non-retryable: 400, 401, 403, schema errors
 */
export function classifyError(error: unknown): ErrorClassification {
  if (error instanceof Error) {
    const message = error.message;

    // Check for HTTP status code patterns in the message
    for (const code of NON_RETRYABLE_STATUS_CODES) {
      if (message.includes(String(code))) {
        return 'non-retryable';
      }
    }

    for (const code of RETRYABLE_STATUS_CODES) {
      if (message.includes(String(code))) {
        return 'retryable';
      }
    }

    // Check message patterns
    for (const pattern of RETRYABLE_PATTERNS) {
      if (pattern.test(message)) {
        return 'retryable';
      }
    }
  }

  // Check if it's an object with a status property
  if (
    error !== null &&
    typeof error === 'object' &&
    'status' in error &&
    typeof (error as { status: unknown }).status === 'number'
  ) {
    const status = (error as { status: number }).status;
    if (RETRYABLE_STATUS_CODES.has(status)) return 'retryable';
    if (NON_RETRYABLE_STATUS_CODES.has(status)) return 'non-retryable';
  }

  // Default: non-retryable (safe default — don't retry unknowns)
  return 'non-retryable';
}

// ---------------------------------------------------------------------------
// Deduplication Lock
// ---------------------------------------------------------------------------

/** Stale lock threshold: 15 minutes (must exceed cron interval of 10 min) */
const STALE_LOCK_MS = 15 * 60 * 1000;

/**
 * Check if a sync is already running. If the lock is stale (older than 10 min),
 * treat it as available (stale-lock recovery).
 *
 * @returns true if a sync is already actively running (lock held)
 */
export function isLockHeld(
  runningSync: { sync_batch_id: string; started_at: string } | null,
  now: Date = new Date(),
): boolean {
  if (!runningSync) return false;

  const startedAt = new Date(runningSync.started_at);
  const age = now.getTime() - startedAt.getTime();

  // Stale lock recovery: if the lock is older than 10 minutes, ignore it
  if (age > STALE_LOCK_MS) return false;

  return true;
}

// ---------------------------------------------------------------------------
// Exponential Backoff
// ---------------------------------------------------------------------------

/**
 * Compute delay for exponential backoff with jitter.
 * Base delay: 1 second, max: 30 seconds.
 */
export function computeBackoffDelay(attempt: number): number {
  const baseMs = 1000;
  const maxMs = 30_000;
  const exponential = Math.min(baseMs * Math.pow(2, attempt), maxMs);
  // Add jitter: 0-50% of the computed delay
  const jitter = Math.random() * exponential * 0.5;
  return Math.floor(exponential + jitter);
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Run a combined sync of both Meta and Ghstly sources.
 *
 * Steps:
 *   1. Acquire deduplication lock
 *   2. Run Meta + Ghstly syncs in parallel (with retries for retryable errors)
 *   3. Log final status
 *
 * Both syncs run independently — one failing does not block the other.
 */
export async function runCombinedSync(
  type: SyncType,
  persistence: OrchestratorPersistence,
  metaSyncFn: MetaSyncFn,
  ghstlySyncFn: GhstlySyncFn,
  options: CombinedSyncOptions = {},
): Promise<CombinedSyncResult> {
  const {
    triggeredBy = 'system',
    backfillDays = 30,
    maxRetries = 3,
  } = options;

  const syncBatchId = crypto.randomUUID();
  const startTime = Date.now();
  let totalRetries = 0;

  // --- Check deduplication lock ---
  const runningSync = await persistence.findRunningSync();
  if (isLockHeld(runningSync)) {
    // Another sync is actively running — abort
    await persistence.insertSyncLog({
      sync_batch_id: syncBatchId,
      source: 'combined',
      stage: 'orchestrate',
      status: 'skipped',
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: 0,
      error_class: 'DeduplicationLock',
      error_message: `Sync already running: ${runningSync!.sync_batch_id}`,
      sync_type: type,
      triggered_by: triggeredBy,
    });

    return {
      syncBatchId,
      type,
      metaSuccess: false,
      ghstlySuccess: false,
      metaError: 'Skipped: another sync is running',
      ghstlyError: 'Skipped: another sync is running',
      durationMs: Date.now() - startTime,
      totalRetries: 0,
    };
  }

  // --- Acquire lock: log combined orchestrate as running ---
  await persistence.insertSyncLog({
    sync_batch_id: syncBatchId,
    source: 'combined',
    stage: 'orchestrate',
    status: 'running',
    started_at: new Date().toISOString(),
    sync_type: type,
    triggered_by: triggeredBy,
  });

  // --- Run Meta and Ghstly syncs in parallel ---
  // These are independent API sources with no data dependency.
  // Running in parallel saves 3-5s per sync cycle.

  async function runSourceSync(
    source: 'meta' | 'ghstly',
    syncFn: () => Promise<{ recordsSynced: number; watermarkDate?: string }>,
  ): Promise<{ success: boolean; error?: string; retries: number }> {
    const sourceStart = Date.now();
    try {
      await persistence.insertSyncLog({
        sync_batch_id: syncBatchId,
        source,
        stage: 'fetch',
        status: 'running',
        started_at: new Date().toISOString(),
        sync_type: type,
        triggered_by: triggeredBy,
      });

      const result = await runWithRetry(syncFn, maxRetries);

      await persistence.insertSyncLog({
        sync_batch_id: syncBatchId,
        source,
        stage: 'persist',
        status: 'success',
        started_at: new Date(sourceStart).toISOString(),
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - sourceStart,
        records_synced: result.result.recordsSynced,
        watermark_date: result.result.watermarkDate,
        sync_type: type,
        triggered_by: triggeredBy,
      });

      return { success: true, retries: result.retries };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorClass = classifyError(error);

      await persistence.insertSyncLog({
        sync_batch_id: syncBatchId,
        source,
        stage: 'persist',
        status: 'failed',
        started_at: new Date(sourceStart).toISOString(),
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - sourceStart,
        error_class: errorClass,
        error_message: errorMsg,
        sync_type: type,
        triggered_by: triggeredBy,
      });

      return { success: false, error: errorMsg, retries: 0 };
    }
  }

  const [metaOutcome, ghstlyOutcome] = await Promise.all([
    runSourceSync('meta', () => metaSyncFn(type, syncBatchId, { backfillDays })),
    runSourceSync('ghstly', () => ghstlySyncFn(type, syncBatchId, { backfillDays })),
  ]);

  const metaSuccess = metaOutcome.success;
  const metaError = metaOutcome.error;
  const ghstlySuccess = ghstlyOutcome.success;
  const ghstlyError = ghstlyOutcome.error;
  totalRetries += metaOutcome.retries + ghstlyOutcome.retries;

  // --- Log combined completion ---
  const durationMs = Date.now() - startTime;
  const combinedStatus: SyncStatus =
    metaSuccess && ghstlySuccess ? 'success' : 'failed';

  await persistence.insertSyncLog({
    sync_batch_id: syncBatchId,
    source: 'combined',
    stage: 'orchestrate',
    status: combinedStatus,
    started_at: new Date(startTime).toISOString(),
    completed_at: new Date().toISOString(),
    duration_ms: durationMs,
    sync_type: type,
    triggered_by: triggeredBy,
    context: {
      metaSuccess,
      ghstlySuccess,
      totalRetries,
      ...(metaError ? { metaError } : {}),
      ...(ghstlyError ? { ghstlyError } : {}),
    },
  });

  return {
    syncBatchId,
    type,
    metaSuccess,
    ghstlySuccess,
    metaError,
    ghstlyError,
    durationMs,
    totalRetries,
  };
}

// ---------------------------------------------------------------------------
// Retry helper
// ---------------------------------------------------------------------------

interface RetryResult<T> {
  result: T;
  retries: number;
}

/**
 * Run a function with exponential backoff retries for retryable errors.
 * Non-retryable errors are thrown immediately.
 */
async function runWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
): Promise<RetryResult<T>> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      return { result, retries: attempt };
    } catch (error) {
      lastError = error;

      // Only retry retryable errors
      if (classifyError(error) !== 'retryable') {
        throw error;
      }

      // Don't retry past max
      if (attempt >= maxRetries) {
        throw error;
      }

      // Backoff before retry
      const delay = computeBackoffDelay(attempt);
      await sleep(delay);
    }
  }

  // Should never reach here, but TypeScript needs it
  throw lastError;
}
