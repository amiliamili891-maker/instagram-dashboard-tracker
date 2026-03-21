/**
 * Tests for Reconciliation Engine
 *
 * Covers:
 *   - Drift classification (healthy, warning, breach)
 *   - Row-level reconciliation
 *   - Full reconciliation run with alert generation
 *   - Suppression threshold logic
 *   - Edge cases (zero values, identical values)
 */

import { describe, it, expect, vi } from 'vitest';
import {
  classifyDrift,
  reconcileRow,
  runReconciliation,
  type StatsForReconciliation,
  type SessionAggregateForReconciliation,
  type ReconciliationPersistence,
} from './reconciliation';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeStats(overrides: Partial<StatsForReconciliation> = {}): StatsForReconciliation {
  return {
    report_date: '2026-03-20',
    entity_level: 'ad',
    entity_id: 'ad_001',
    chats: 100,
    reveals: 40,
    click_throughs: 20,
    ghstly_conversions: 5,
    ...overrides,
  };
}

function makeSessionAgg(overrides: Partial<SessionAggregateForReconciliation> = {}): SessionAggregateForReconciliation {
  return {
    report_date: '2026-03-20',
    entity_level: 'ad',
    entity_id: 'ad_001',
    chats: 100,
    reveals: 40,
    click_throughs: 20,
    conversions: 5,
    ...overrides,
  };
}

function makeMockPersistence(
  statsRows: StatsForReconciliation[] = [],
  sessionAggs: SessionAggregateForReconciliation[] = [],
): ReconciliationPersistence {
  return {
    fetchGhstlyStatsForReconciliation: vi.fn().mockResolvedValue(statsRows),
    fetchSessionAggregates: vi.fn().mockResolvedValue(sessionAggs),
    insertAlert: vi.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// classifyDrift
// ---------------------------------------------------------------------------

describe('classifyDrift', () => {
  it('classifies identical values as healthy', () => {
    const result = classifyDrift(100, 100);
    expect(result.level).toBe('healthy');
    expect(result.absoluteDrift).toBe(0);
  });

  it('classifies small absolute drift (<= 10) as healthy regardless of relative %', () => {
    // 5 vs 10 = 50% relative but only 5 absolute
    const result = classifyDrift(5, 10);
    expect(result.level).toBe('healthy');
    expect(result.absoluteDrift).toBe(5);
  });

  it('classifies <= 5% relative drift as healthy', () => {
    // 100 vs 104 = 4% relative, 4 absolute
    const result = classifyDrift(100, 104);
    expect(result.level).toBe('healthy');
  });

  it('classifies 5-10% relative drift with > 10 absolute as warning', () => {
    // 100 vs 108 = 8% relative, 8 absolute (above 5% relative but within 10 absolute)
    // Actually 8 absolute is <= 10, so this would be healthy by absolute rule
    // Let's use bigger numbers
    // 200 vs 216 = 16 absolute, 8% relative
    const result = classifyDrift(200, 216);
    expect(result.level).toBe('warning');
  });

  it('classifies > 10% relative drift as breach', () => {
    // 100 vs 115 = 15% relative, 15 absolute
    const result = classifyDrift(100, 115);
    expect(result.level).toBe('breach');
  });

  it('classifies > 25 absolute drift as breach', () => {
    // 100 vs 130 = 30 absolute, 30% relative
    const result = classifyDrift(100, 130);
    expect(result.level).toBe('breach');
    expect(result.absoluteDrift).toBe(30);
  });

  it('handles zero stats value and non-zero session value', () => {
    // 0 vs 5 = 5 absolute (healthy by absolute threshold)
    const result = classifyDrift(0, 5);
    expect(result.level).toBe('healthy');
    expect(result.absoluteDrift).toBe(5);
  });

  it('handles both zero values', () => {
    const result = classifyDrift(0, 0);
    expect(result.level).toBe('healthy');
    expect(result.absoluteDrift).toBe(0);
    expect(result.relativeDriftPercent).toBeNull();
  });

  it('returns correct relative drift percent', () => {
    const result = classifyDrift(100, 90);
    expect(result.absoluteDrift).toBe(10);
    // relative = 10/100 * 100 = 10%
    expect(result.relativeDriftPercent).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// reconcileRow
// ---------------------------------------------------------------------------

describe('reconcileRow', () => {
  it('produces healthy overall for identical stats and sessions', () => {
    const stats = makeStats();
    const sessionAgg = makeSessionAgg();
    const result = reconcileRow(stats, sessionAgg);

    expect(result.overallLevel).toBe('healthy');
    expect(result.drifts).toHaveLength(4);
    for (const d of result.drifts) {
      expect(d.level).toBe('healthy');
    }
  });

  it('overall level is the worst across all metrics', () => {
    const stats = makeStats({ chats: 100, reveals: 100 });
    const sessionAgg = makeSessionAgg({
      chats: 100,
      reveals: 115, // 15% drift = breach
    });
    const result = reconcileRow(stats, sessionAgg);

    expect(result.overallLevel).toBe('breach');
    // Chats should be healthy, reveals should be breach
    const chats = result.drifts.find((d) => d.metric === 'chats');
    const reveals = result.drifts.find((d) => d.metric === 'reveals');
    expect(chats?.level).toBe('healthy');
    expect(reveals?.level).toBe('breach');
  });

  it('reconciles all four metrics: chats, reveals, click_throughs, conversions', () => {
    const stats = makeStats();
    const sessionAgg = makeSessionAgg();
    const result = reconcileRow(stats, sessionAgg);

    const metricNames = result.drifts.map((d) => d.metric);
    expect(metricNames).toContain('chats');
    expect(metricNames).toContain('reveals');
    expect(metricNames).toContain('click_throughs');
    expect(metricNames).toContain('conversions');
  });

  it('captures report date and entity info', () => {
    const stats = makeStats({ report_date: '2026-03-21', entity_id: 'ad_xyz' });
    const sessionAgg = makeSessionAgg({ report_date: '2026-03-21', entity_id: 'ad_xyz' });
    const result = reconcileRow(stats, sessionAgg);

    expect(result.reportDate).toBe('2026-03-21');
    expect(result.entityId).toBe('ad_xyz');
    expect(result.entityLevel).toBe('ad');
  });
});

// ---------------------------------------------------------------------------
// runReconciliation — full flow
// ---------------------------------------------------------------------------

describe('runReconciliation', () => {
  const dateRange = { from: '2026-03-20', to: '2026-03-20' };

  it('reconciles matching stats and session rows', async () => {
    const stats = [makeStats()];
    const sessions = [makeSessionAgg()];
    const persistence = makeMockPersistence(stats, sessions);

    const result = await runReconciliation(persistence, dateRange, 'test-batch');

    expect(result.totalChecked).toBe(1);
    expect(result.healthyCount).toBe(1);
    expect(result.warningCount).toBe(0);
    expect(result.breachCount).toBe(0);
    expect(result.shouldSuppressRecommendations).toBe(false);
  });

  it('generates alerts for breach rows', async () => {
    const stats = [makeStats({ chats: 100 })];
    const sessions = [makeSessionAgg({ chats: 150 })]; // 50% drift = breach
    const persistence = makeMockPersistence(stats, sessions);

    const result = await runReconciliation(persistence, dateRange, 'test-batch');

    expect(result.breachCount).toBe(1);
    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0].severity).toBe('critical');
    expect(result.alerts[0].message).toContain('breach');

    // Alert was persisted
    expect(persistence.insertAlert).toHaveBeenCalledTimes(1);
    const alertCall = vi.mocked(persistence.insertAlert).mock.calls[0][0];
    expect(alertCall.alert_type).toBe('data_quality');
    expect(alertCall.severity).toBe('critical');
  });

  it('generates warning alerts for warning-level drift', async () => {
    // 200 vs 216 = 16 absolute, 8% relative = warning
    const stats = [makeStats({ chats: 200, reveals: 200, click_throughs: 200, ghstly_conversions: 200 })];
    const sessions = [makeSessionAgg({ chats: 216, reveals: 200, click_throughs: 200, conversions: 200 })];
    const persistence = makeMockPersistence(stats, sessions);

    const result = await runReconciliation(persistence, dateRange, 'test-batch');

    expect(result.warningCount).toBe(1);
    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0].severity).toBe('warning');
  });

  it('suppresses recommendations when breach rate exceeds 5%', async () => {
    // Create 20 rows, 2 of which breach (10% > 5%)
    const stats: StatsForReconciliation[] = [];
    const sessions: SessionAggregateForReconciliation[] = [];

    for (let i = 0; i < 20; i++) {
      const entityId = `ad_${i.toString().padStart(3, '0')}`;
      stats.push(makeStats({ entity_id: entityId, chats: 100 }));

      if (i < 2) {
        // Breach: 50% drift
        sessions.push(makeSessionAgg({ entity_id: entityId, chats: 150 }));
      } else {
        sessions.push(makeSessionAgg({ entity_id: entityId, chats: 100 }));
      }
    }

    const persistence = makeMockPersistence(stats, sessions);
    const result = await runReconciliation(persistence, dateRange, 'test-batch');

    expect(result.totalChecked).toBe(20);
    expect(result.breachCount).toBe(2);
    expect(result.breachRatePercent).toBe(10);
    expect(result.shouldSuppressRecommendations).toBe(true);
  });

  it('does not suppress when breach rate is below 5%', async () => {
    // Create 100 rows, 3 of which breach (3% < 5%)
    const stats: StatsForReconciliation[] = [];
    const sessions: SessionAggregateForReconciliation[] = [];

    for (let i = 0; i < 100; i++) {
      const entityId = `ad_${i.toString().padStart(3, '0')}`;
      stats.push(makeStats({ entity_id: entityId, chats: 100 }));

      if (i < 3) {
        sessions.push(makeSessionAgg({ entity_id: entityId, chats: 150 }));
      } else {
        sessions.push(makeSessionAgg({ entity_id: entityId, chats: 100 }));
      }
    }

    const persistence = makeMockPersistence(stats, sessions);
    const result = await runReconciliation(persistence, dateRange, 'test-batch');

    expect(result.breachCount).toBe(3);
    expect(result.breachRatePercent).toBe(3);
    expect(result.shouldSuppressRecommendations).toBe(false);
  });

  it('skips stats rows without matching session aggregates', async () => {
    const stats = [
      makeStats({ entity_id: 'ad_001' }),
      makeStats({ entity_id: 'ad_no_sessions' }),
    ];
    const sessions = [makeSessionAgg({ entity_id: 'ad_001' })];
    const persistence = makeMockPersistence(stats, sessions);

    const result = await runReconciliation(persistence, dateRange, 'test-batch');

    expect(result.totalChecked).toBe(1);
  });

  it('handles empty datasets', async () => {
    const persistence = makeMockPersistence([], []);
    const result = await runReconciliation(persistence, dateRange, 'test-batch');

    expect(result.totalChecked).toBe(0);
    expect(result.healthyCount).toBe(0);
    expect(result.shouldSuppressRecommendations).toBe(false);
    expect(result.alerts).toHaveLength(0);
  });
});
