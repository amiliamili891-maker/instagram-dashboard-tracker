import { describe, expect, it, vi } from 'vitest';

import {
  classifyError,
  computeBackoffDelay,
  isLockHeld,
  runCombinedSync,
  type CombinedSyncOptions,
  type GhstlySyncFn,
  type MetaSyncFn,
  type OrchestratorPersistence,
  type OrchestratorSyncLog,
} from '@/lib/sync/orchestrator';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createMockPersistence(
  runningSync: { sync_batch_id: string; started_at: string } | null = null,
) {
  const logs: OrchestratorSyncLog[] = [];
  return {
    persistence: {
      insertSyncLog: vi.fn(async (entry: OrchestratorSyncLog) => {
        logs.push(entry);
      }),
      findRunningSync: vi.fn(async () => runningSync),
    } satisfies OrchestratorPersistence,
    logs,
  };
}

function createSuccessMetaSync(): MetaSyncFn {
  return vi.fn(async () => ({ recordsSynced: 42, watermarkDate: '2026-03-21' }));
}

function createSuccessGhstlySync(): GhstlySyncFn {
  return vi.fn(async () => ({ recordsSynced: 100, watermarkDate: '2026-03-21' }));
}

function createFailingSync(message: string): MetaSyncFn | GhstlySyncFn {
  return vi.fn(async () => {
    throw new Error(message);
  });
}

// ---------------------------------------------------------------------------
// classifyError tests
// ---------------------------------------------------------------------------

describe('classifyError', () => {
  it('classifies 429 as retryable', () => {
    expect(classifyError(new Error('Rate limit 429'))).toBe('retryable');
  });

  it('classifies 500 as retryable', () => {
    expect(classifyError(new Error('Server error 500'))).toBe('retryable');
  });

  it('classifies 502 as retryable', () => {
    expect(classifyError(new Error('Bad gateway 502'))).toBe('retryable');
  });

  it('classifies 503 as retryable', () => {
    expect(classifyError(new Error('Service unavailable 503'))).toBe('retryable');
  });

  it('classifies network errors as retryable', () => {
    expect(classifyError(new Error('ECONNRESET'))).toBe('retryable');
    expect(classifyError(new Error('ETIMEDOUT'))).toBe('retryable');
    expect(classifyError(new Error('fetch failed'))).toBe('retryable');
    expect(classifyError(new Error('socket hang up'))).toBe('retryable');
    expect(classifyError(new Error('network error'))).toBe('retryable');
  });

  it('classifies 401 as non-retryable', () => {
    expect(classifyError(new Error('Unauthorized 401'))).toBe('non-retryable');
  });

  it('classifies 400 as non-retryable', () => {
    expect(classifyError(new Error('Bad request 400'))).toBe('non-retryable');
  });

  it('classifies 403 as non-retryable', () => {
    expect(classifyError(new Error('Forbidden 403'))).toBe('non-retryable');
  });

  it('classifies schema errors as non-retryable', () => {
    expect(classifyError(new Error('Unexpected field in response'))).toBe('non-retryable');
  });

  it('classifies unknown errors as non-retryable (safe default)', () => {
    expect(classifyError(new Error('Something weird happened'))).toBe('non-retryable');
    expect(classifyError('string error')).toBe('non-retryable');
    expect(classifyError(null)).toBe('non-retryable');
  });

  it('classifies objects with retryable status codes', () => {
    expect(classifyError({ status: 429 })).toBe('retryable');
    expect(classifyError({ status: 500 })).toBe('retryable');
  });

  it('classifies objects with non-retryable status codes', () => {
    expect(classifyError({ status: 400 })).toBe('non-retryable');
    expect(classifyError({ status: 401 })).toBe('non-retryable');
  });
});

// ---------------------------------------------------------------------------
// isLockHeld tests
// ---------------------------------------------------------------------------

describe('isLockHeld', () => {
  it('returns false when no running sync exists', () => {
    expect(isLockHeld(null)).toBe(false);
  });

  it('returns true when a recent running sync exists', () => {
    const now = new Date();
    const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);
    expect(
      isLockHeld(
        { sync_batch_id: 'test-123', started_at: fiveMinAgo.toISOString() },
        now,
      ),
    ).toBe(true);
  });

  it('returns false for stale lock (older than 15 minutes)', () => {
    const now = new Date();
    const sixteenMinAgo = new Date(now.getTime() - 16 * 60 * 1000);
    expect(
      isLockHeld(
        { sync_batch_id: 'test-stale', started_at: sixteenMinAgo.toISOString() },
        now,
      ),
    ).toBe(false);
  });

  it('returns true for lock exactly at 15 minute boundary', () => {
    const now = new Date();
    const fifteenMinAgo = new Date(now.getTime() - 15 * 60 * 1000);
    expect(
      isLockHeld(
        { sync_batch_id: 'test-boundary', started_at: fifteenMinAgo.toISOString() },
        now,
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// computeBackoffDelay tests
// ---------------------------------------------------------------------------

describe('computeBackoffDelay', () => {
  it('returns a delay for attempt 0', () => {
    const delay = computeBackoffDelay(0);
    // Base = 1000ms, jitter up to 500ms → range [1000, 1500]
    expect(delay).toBeGreaterThanOrEqual(1000);
    expect(delay).toBeLessThanOrEqual(1500);
  });

  it('increases delay for higher attempts', () => {
    // Attempt 2: base = min(1000 * 4, 30000) = 4000, jitter [4000, 6000]
    const delay = computeBackoffDelay(2);
    expect(delay).toBeGreaterThanOrEqual(4000);
    expect(delay).toBeLessThanOrEqual(6000);
  });

  it('caps delay at 30 seconds', () => {
    const delay = computeBackoffDelay(20);
    // Should be capped at 30000 + up to 15000 jitter = max 45000
    expect(delay).toBeLessThanOrEqual(45000);
  });
});

// ---------------------------------------------------------------------------
// runCombinedSync tests
// ---------------------------------------------------------------------------

describe('runCombinedSync', () => {
  it('runs both syncs successfully', async () => {
    const { persistence } = createMockPersistence();
    const metaSync = createSuccessMetaSync();
    const ghstlySync = createSuccessGhstlySync();

    const result = await runCombinedSync(
      'incremental',
      persistence,
      metaSync,
      ghstlySync,
      { maxRetries: 0 },
    );

    expect(result.metaSuccess).toBe(true);
    expect(result.ghstlySuccess).toBe(true);
    expect(result.type).toBe('incremental');
    expect(result.syncBatchId).toBeTruthy();
    expect(metaSync).toHaveBeenCalledTimes(1);
    expect(ghstlySync).toHaveBeenCalledTimes(1);
  });

  it('skips sync when deduplication lock is held', async () => {
    const now = new Date();
    const recentLock = {
      sync_batch_id: 'existing-sync',
      started_at: new Date(now.getTime() - 2 * 60 * 1000).toISOString(),
    };
    const { persistence } = createMockPersistence(recentLock);
    const metaSync = createSuccessMetaSync();
    const ghstlySync = createSuccessGhstlySync();

    const result = await runCombinedSync(
      'incremental',
      persistence,
      metaSync,
      ghstlySync,
    );

    expect(result.metaSuccess).toBe(false);
    expect(result.ghstlySuccess).toBe(false);
    expect(result.metaError).toContain('another sync is running');
    expect(metaSync).not.toHaveBeenCalled();
    expect(ghstlySync).not.toHaveBeenCalled();
  });

  it('proceeds when lock is stale (older than 15 min)', async () => {
    const now = new Date();
    const staleLock = {
      sync_batch_id: 'stale-sync',
      started_at: new Date(now.getTime() - 16 * 60 * 1000).toISOString(),
    };
    const { persistence } = createMockPersistence(staleLock);
    const metaSync = createSuccessMetaSync();
    const ghstlySync = createSuccessGhstlySync();

    const result = await runCombinedSync(
      'incremental',
      persistence,
      metaSync,
      ghstlySync,
      { maxRetries: 0 },
    );

    expect(result.metaSuccess).toBe(true);
    expect(result.ghstlySuccess).toBe(true);
    expect(metaSync).toHaveBeenCalledTimes(1);
  });

  it('continues ghstly sync when meta fails with non-retryable error', async () => {
    const { persistence } = createMockPersistence();
    const metaSync = createFailingSync('Unauthorized 401') as MetaSyncFn;
    const ghstlySync = createSuccessGhstlySync();

    const result = await runCombinedSync(
      'incremental',
      persistence,
      metaSync,
      ghstlySync,
      { maxRetries: 0 },
    );

    expect(result.metaSuccess).toBe(false);
    expect(result.metaError).toContain('401');
    expect(result.ghstlySuccess).toBe(true);
    expect(ghstlySync).toHaveBeenCalledTimes(1);
  });

  it('continues meta when ghstly fails', async () => {
    const { persistence } = createMockPersistence();
    const metaSync = createSuccessMetaSync();
    const ghstlySync = createFailingSync('Bad request 400') as GhstlySyncFn;

    const result = await runCombinedSync(
      'incremental',
      persistence,
      metaSync,
      ghstlySync,
      { maxRetries: 0 },
    );

    expect(result.metaSuccess).toBe(true);
    expect(result.ghstlySuccess).toBe(false);
    expect(result.ghstlyError).toContain('400');
  });

  it('logs the combined sync with correct status on full success', async () => {
    const { persistence, logs } = createMockPersistence();
    const metaSync = createSuccessMetaSync();
    const ghstlySync = createSuccessGhstlySync();

    await runCombinedSync('incremental', persistence, metaSync, ghstlySync, {
      maxRetries: 0,
      triggeredBy: 'test-user',
    });

    // Should have logs for: combined-running, meta-fetch-running, meta-persist-success,
    // ghstly-fetch-running, ghstly-persist-success, combined-success
    const combinedLogs = logs.filter((l) => l.source === 'combined');
    expect(combinedLogs.length).toBe(2); // running + success
    expect(combinedLogs[0].status).toBe('running');
    expect(combinedLogs[1].status).toBe('success');
    expect(combinedLogs[1].triggered_by).toBe('test-user');
  });

  it('logs combined status as failed when one source fails', async () => {
    const { persistence, logs } = createMockPersistence();
    const metaSync = createFailingSync('Unauthorized 401') as MetaSyncFn;
    const ghstlySync = createSuccessGhstlySync();

    await runCombinedSync('incremental', persistence, metaSync, ghstlySync, {
      maxRetries: 0,
    });

    const finalCombinedLog = logs.filter(
      (l) => l.source === 'combined' && l.status !== 'running',
    );
    expect(finalCombinedLog.length).toBe(1);
    expect(finalCombinedLog[0].status).toBe('failed');
  });

  it('passes backfill type and days through to sync functions', async () => {
    const { persistence } = createMockPersistence();
    const metaSync = createSuccessMetaSync();
    const ghstlySync = createSuccessGhstlySync();

    await runCombinedSync('backfill', persistence, metaSync, ghstlySync, {
      maxRetries: 0,
      backfillDays: 60,
    });

    expect(metaSync).toHaveBeenCalledWith('backfill', expect.any(String), {
      backfillDays: 60,
    });
    expect(ghstlySync).toHaveBeenCalledWith('backfill', expect.any(String), {
      backfillDays: 60,
    });
  });

  it('retries retryable errors with backoff', async () => {
    const { persistence } = createMockPersistence();
    let callCount = 0;
    const metaSync: MetaSyncFn = vi.fn(async () => {
      callCount++;
      if (callCount <= 2) {
        throw new Error('Server error 500');
      }
      return { recordsSynced: 10 };
    });
    const ghstlySync = createSuccessGhstlySync();

    const result = await runCombinedSync(
      'incremental',
      persistence,
      metaSync,
      ghstlySync,
      { maxRetries: 3 },
    );

    expect(result.metaSuccess).toBe(true);
    // Should have retried twice before succeeding
    expect(callCount).toBe(3);
    expect(result.totalRetries).toBeGreaterThanOrEqual(2);
  }, 15000); // Allow extra time for backoff delays

  it('does not retry non-retryable errors', async () => {
    const { persistence } = createMockPersistence();
    const metaSync: MetaSyncFn = vi.fn(async () => {
      throw new Error('Unauthorized 401');
    });
    const ghstlySync = createSuccessGhstlySync();

    const result = await runCombinedSync(
      'incremental',
      persistence,
      metaSync,
      ghstlySync,
      { maxRetries: 3 },
    );

    expect(result.metaSuccess).toBe(false);
    // Should have been called only once (no retries)
    expect(metaSync).toHaveBeenCalledTimes(1);
  });
});
