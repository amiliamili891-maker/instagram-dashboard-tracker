/**
 * Freshness Engine
 *
 * Computes data freshness relative to the latest scheduled 6-hour window
 * (6am, 12pm, 6pm, midnight PT). Uses America/Los_Angeles timezone.
 *
 * States:
 *   - fresh: both sources completed in latest window within 90-min grace
 *   - degraded: only one source completed
 *   - stale: neither completed or window overdue beyond grace
 */

import { REPORTING_TIMEZONE } from '@/lib/contracts/data-contract';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FreshnessState = 'fresh' | 'degraded' | 'stale';

export interface FreshnessResult {
  state: FreshnessState;
  /** The latest scheduled window boundary (ISO string) */
  latestWindow: string;
  /** Grace period deadline (ISO string) */
  graceDeadline: string;
  /** Whether each source completed in the latest window */
  meta: { completed: boolean; lastSuccessAt: string | null };
  ghstly: { completed: boolean; lastSuccessAt: string | null };
  /** Current time used for computation (ISO string) */
  evaluatedAt: string;
}

export interface SyncLogRow {
  source: string;
  status: string;
  completed_at: string | null;
  stage: string;
}

// ---------------------------------------------------------------------------
// Window computation
// ---------------------------------------------------------------------------

/** Scheduled window hours in PT: midnight, 6am, 12pm, 6pm */
const WINDOW_HOURS = [0, 6, 12, 18];

/** Grace period in minutes after window boundary */
const GRACE_MINUTES = 90;

/**
 * Get the latest scheduled 6-hour window boundary at or before `now`
 * in America/Los_Angeles timezone.
 */
export function getLatestWindowBoundary(now: Date): Date {
  // Get the current time in LA
  const laString = now.toLocaleString('en-US', { timeZone: REPORTING_TIMEZONE });
  const laDate = new Date(laString);

  const currentHour = laDate.getHours();

  // Find the latest window hour that is <= currentHour
  let windowHour = WINDOW_HOURS[0];
  for (const h of WINDOW_HOURS) {
    if (h <= currentHour) {
      windowHour = h;
    }
  }

  // Build the window boundary in LA time
  const windowDate = new Date(laDate);
  windowDate.setHours(windowHour, 0, 0, 0);

  // Convert back to UTC by computing the offset
  // We need the actual UTC time that corresponds to this LA local time.
  // The offset between laDate and now gives us the timezone difference.
  const utcOffsetMs = now.getTime() - laDate.getTime();
  const windowUtc = new Date(windowDate.getTime() + utcOffsetMs);

  return windowUtc;
}

/**
 * Get the grace deadline: window boundary + 90 minutes.
 */
export function getGraceDeadline(windowBoundary: Date): Date {
  return new Date(windowBoundary.getTime() + GRACE_MINUTES * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Freshness computation
// ---------------------------------------------------------------------------

/**
 * Determine if a source completed successfully within the latest window.
 * A source is "completed" if it has a success log entry with completed_at
 * between the window boundary and now.
 */
export function sourceCompletedInWindow(
  logs: SyncLogRow[],
  source: 'meta' | 'ghstly',
  windowBoundary: Date,
  now: Date,
): { completed: boolean; lastSuccessAt: string | null } {
  const windowStart = windowBoundary.toISOString();
  const currentTime = now.toISOString();

  // Find success logs for this source in the window
  const successLogs = logs.filter(
    (log) =>
      log.source === source &&
      log.status === 'success' &&
      log.completed_at !== null &&
      log.completed_at >= windowStart &&
      log.completed_at <= currentTime,
  );

  if (successLogs.length === 0) {
    // Check for any success ever (for the lastSuccessAt field)
    const anySuccess = logs
      .filter((log) => log.source === source && log.status === 'success' && log.completed_at !== null)
      .sort((a, b) => (b.completed_at! > a.completed_at! ? 1 : -1));

    return {
      completed: false,
      lastSuccessAt: anySuccess.length > 0 ? anySuccess[0].completed_at : null,
    };
  }

  // Sort to get the latest
  const sorted = successLogs.sort((a, b) =>
    b.completed_at! > a.completed_at! ? 1 : -1,
  );

  return { completed: true, lastSuccessAt: sorted[0].completed_at };
}

/**
 * Compute the current freshness state from sync_logs.
 *
 * @param logs - Recent sync log rows (should cover at least last 24h)
 * @param now - Current time (injectable for testing)
 */
export function computeFreshness(
  logs: SyncLogRow[],
  now: Date = new Date(),
): FreshnessResult {
  const windowBoundary = getLatestWindowBoundary(now);
  const graceDeadline = getGraceDeadline(windowBoundary);

  const meta = sourceCompletedInWindow(logs, 'meta', windowBoundary, now);
  const ghstly = sourceCompletedInWindow(logs, 'ghstly', windowBoundary, now);

  let state: FreshnessState;

  if (meta.completed && ghstly.completed) {
    state = 'fresh';
  } else if (meta.completed || ghstly.completed) {
    // Only one source completed — but are we still within grace?
    if (now <= graceDeadline) {
      // Within grace, one source done = degraded (the other might still come)
      state = 'degraded';
    } else {
      // Past grace, only one done = degraded
      state = 'degraded';
    }
  } else {
    // Neither completed
    if (now <= graceDeadline) {
      // Within grace, neither done yet — still stale
      state = 'stale';
    } else {
      // Past grace, neither done
      state = 'stale';
    }
  }

  return {
    state,
    latestWindow: windowBoundary.toISOString(),
    graceDeadline: graceDeadline.toISOString(),
    meta,
    ghstly,
    evaluatedAt: now.toISOString(),
  };
}
