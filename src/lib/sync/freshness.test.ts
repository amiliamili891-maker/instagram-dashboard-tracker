import { describe, expect, it } from 'vitest';

import {
  computeFreshness,
  getGraceDeadline,
  getLatestWindowBoundary,
  sourceCompletedInWindow,
  type SyncLogRow,
} from '@/lib/sync/freshness';

// ---------------------------------------------------------------------------
// Helper: create a Date at a specific PT time by constructing a UTC date
// that corresponds to the given PT hour. For simplicity in tests, we use
// a fixed date and manually offset for PST (UTC-8) or PDT (UTC-7).
// March 2026 is PDT (UTC-7).
// ---------------------------------------------------------------------------

/** Create a UTC Date that corresponds to the given PT hour on 2026-03-21 (PDT, UTC-7) */
function ptDate(hour: number, minute = 0): Date {
  // 2026-03-21 at hour:minute PT = hour+7:minute UTC
  // Handle hour overflow past 24 (wraps to next day)
  const utcHour = hour + 7;
  const dayOffset = Math.floor(utcHour / 24);
  const normalizedHour = utcHour % 24;
  const day = 21 + dayOffset;
  return new Date(`2026-03-${String(day).padStart(2, '0')}T${String(normalizedHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`);
}

function makeLog(
  source: 'meta' | 'ghstly',
  status: 'success' | 'failed' | 'running',
  completedAt: Date | null,
): SyncLogRow {
  return {
    source,
    status,
    completed_at: completedAt?.toISOString() ?? null,
    stage: 'persist',
  };
}

// ---------------------------------------------------------------------------
// getLatestWindowBoundary tests
// ---------------------------------------------------------------------------

describe('getLatestWindowBoundary', () => {
  it('returns midnight PT window when current time is before 6am PT', () => {
    const now = ptDate(3, 30); // 3:30 AM PT
    const boundary = getLatestWindowBoundary(now);
    // Should be midnight PT = 07:00 UTC
    expect(boundary.getUTCHours()).toBe(7);
    expect(boundary.getUTCMinutes()).toBe(0);
  });

  it('returns 6am PT window when current time is between 6am and noon PT', () => {
    const now = ptDate(9, 15); // 9:15 AM PT
    const boundary = getLatestWindowBoundary(now);
    // Should be 6am PT = 13:00 UTC
    expect(boundary.getUTCHours()).toBe(13);
    expect(boundary.getUTCMinutes()).toBe(0);
  });

  it('returns noon PT window when current time is between noon and 6pm PT', () => {
    const now = ptDate(14, 0); // 2:00 PM PT
    const boundary = getLatestWindowBoundary(now);
    // Should be noon PT = 19:00 UTC
    expect(boundary.getUTCHours()).toBe(19);
  });

  it('returns 6pm PT window when current time is after 6pm PT', () => {
    const now = ptDate(20, 45); // 8:45 PM PT
    const boundary = getLatestWindowBoundary(now);
    // Should be 6pm PT = 01:00 UTC next day (18+7=25=01 next day)
    // Actually 18+7 = 25 which wraps to 1:00 UTC on 2026-03-22
    expect(boundary.getUTCHours()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// getGraceDeadline tests
// ---------------------------------------------------------------------------

describe('getGraceDeadline', () => {
  it('adds 90 minutes to the window boundary', () => {
    const boundary = ptDate(6, 0); // 6am PT
    const deadline = getGraceDeadline(boundary);
    const diffMinutes = (deadline.getTime() - boundary.getTime()) / (60 * 1000);
    expect(diffMinutes).toBe(90);
  });
});

// ---------------------------------------------------------------------------
// sourceCompletedInWindow tests
// ---------------------------------------------------------------------------

describe('sourceCompletedInWindow', () => {
  it('returns completed=true when source has success log in the window', () => {
    const windowBoundary = ptDate(6, 0);
    const now = ptDate(7, 30);
    const logs: SyncLogRow[] = [
      makeLog('meta', 'success', ptDate(6, 45)),
    ];

    const result = sourceCompletedInWindow(logs, 'meta', windowBoundary, now);
    expect(result.completed).toBe(true);
    expect(result.lastSuccessAt).toBeTruthy();
  });

  it('returns completed=false when source has no success log in window', () => {
    const windowBoundary = ptDate(12, 0);
    const now = ptDate(13, 0);
    const logs: SyncLogRow[] = [
      // Success was before this window
      makeLog('meta', 'success', ptDate(7, 0)),
    ];

    const result = sourceCompletedInWindow(logs, 'meta', windowBoundary, now);
    expect(result.completed).toBe(false);
    // Should still report the last success
    expect(result.lastSuccessAt).toBeTruthy();
  });

  it('ignores failed logs', () => {
    const windowBoundary = ptDate(6, 0);
    const now = ptDate(7, 30);
    const logs: SyncLogRow[] = [
      makeLog('meta', 'failed', ptDate(6, 45)),
    ];

    const result = sourceCompletedInWindow(logs, 'meta', windowBoundary, now);
    expect(result.completed).toBe(false);
  });

  it('ignores logs from other sources', () => {
    const windowBoundary = ptDate(6, 0);
    const now = ptDate(7, 30);
    const logs: SyncLogRow[] = [
      makeLog('ghstly', 'success', ptDate(6, 45)),
    ];

    const result = sourceCompletedInWindow(logs, 'meta', windowBoundary, now);
    expect(result.completed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeFreshness state transitions
// ---------------------------------------------------------------------------

describe('computeFreshness', () => {
  it('returns fresh when both sources completed in latest window', () => {
    const now = ptDate(7, 30);
    const windowBoundary = ptDate(6, 0);
    const logs: SyncLogRow[] = [
      makeLog('meta', 'success', new Date(windowBoundary.getTime() + 15 * 60 * 1000)),
      makeLog('ghstly', 'success', new Date(windowBoundary.getTime() + 20 * 60 * 1000)),
    ];

    const result = computeFreshness(logs, now);
    expect(result.state).toBe('fresh');
    expect(result.meta.completed).toBe(true);
    expect(result.ghstly.completed).toBe(true);
  });

  it('returns degraded when only meta completed', () => {
    const now = ptDate(7, 30);
    const windowBoundary = ptDate(6, 0);
    const logs: SyncLogRow[] = [
      makeLog('meta', 'success', new Date(windowBoundary.getTime() + 15 * 60 * 1000)),
    ];

    const result = computeFreshness(logs, now);
    expect(result.state).toBe('degraded');
    expect(result.meta.completed).toBe(true);
    expect(result.ghstly.completed).toBe(false);
  });

  it('returns degraded when only ghstly completed', () => {
    const now = ptDate(7, 30);
    const windowBoundary = ptDate(6, 0);
    const logs: SyncLogRow[] = [
      makeLog('ghstly', 'success', new Date(windowBoundary.getTime() + 20 * 60 * 1000)),
    ];

    const result = computeFreshness(logs, now);
    expect(result.state).toBe('degraded');
    expect(result.meta.completed).toBe(false);
    expect(result.ghstly.completed).toBe(true);
  });

  it('returns stale when neither source completed', () => {
    const now = ptDate(8, 0); // Well past the 6am window + grace
    const logs: SyncLogRow[] = [];

    const result = computeFreshness(logs, now);
    expect(result.state).toBe('stale');
    expect(result.meta.completed).toBe(false);
    expect(result.ghstly.completed).toBe(false);
  });

  it('returns stale when both sources failed in the window', () => {
    const now = ptDate(7, 30);
    const windowBoundary = ptDate(6, 0);
    const logs: SyncLogRow[] = [
      makeLog('meta', 'failed', new Date(windowBoundary.getTime() + 15 * 60 * 1000)),
      makeLog('ghstly', 'failed', new Date(windowBoundary.getTime() + 20 * 60 * 1000)),
    ];

    const result = computeFreshness(logs, now);
    expect(result.state).toBe('stale');
  });

  it('transitions from degraded (one source) past grace remains degraded', () => {
    // 2 hours after window — past 90-min grace — one source done
    const now = ptDate(8, 0);
    const windowBoundary = ptDate(6, 0);
    const logs: SyncLogRow[] = [
      makeLog('meta', 'success', new Date(windowBoundary.getTime() + 30 * 60 * 1000)),
    ];

    const result = computeFreshness(logs, now);
    expect(result.state).toBe('degraded');
  });

  it('includes latestWindow and graceDeadline in result', () => {
    const now = ptDate(7, 0);
    const result = computeFreshness([], now);

    expect(result.latestWindow).toBeTruthy();
    expect(result.graceDeadline).toBeTruthy();
    expect(result.evaluatedAt).toBe(now.toISOString());

    // Grace should be 90 min after window
    const windowTime = new Date(result.latestWindow).getTime();
    const graceTime = new Date(result.graceDeadline).getTime();
    expect(graceTime - windowTime).toBe(90 * 60 * 1000);
  });
});
