/**
 * Tests for Anomaly Detector
 *
 * Covers:
 *   - Anomaly detection thresholds
 *   - Direction of change (increase/decrease)
 *   - Severity classification (warning/critical)
 *   - Null and zero handling
 *   - Window computation
 *   - Full detection flow
 */

import { describe, it, expect, vi } from 'vitest';
import {
  detectEntityAnomalies,
  detectAnomalies,
  computeWindows,
  type EntityWindowMetrics,
  type AnomalyPersistence,
  DEFAULT_ANOMALY_THRESHOLDS,
} from './anomaly-detector';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeWindowMetrics(
  overrides: Partial<EntityWindowMetrics> = {},
): EntityWindowMetrics {
  return {
    entityId: 'ad_001',
    entityLevel: 'ad',
    spend: 10.0,
    chats: 50,
    visits: 100,
    reveals: 20,
    chat_rate: 0.80,
    cost_per_chat: 0.20,
    reveal_rate: 0.40,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Detection Thresholds
// ---------------------------------------------------------------------------

describe('detectEntityAnomalies — thresholds', () => {
  it('flags cost_per_chat increase above 30%', () => {
    const recent = makeWindowMetrics({ cost_per_chat: 0.30 });
    const prior = makeWindowMetrics({ cost_per_chat: 0.20 });

    const anomalies = detectEntityAnomalies(recent, prior);
    const cpcAnomaly = anomalies.find((a) => a.metric === 'cost_per_chat');

    expect(cpcAnomaly).toBeDefined();
    expect(cpcAnomaly!.direction).toBe('increase');
    expect(cpcAnomaly!.changePercent).toBeCloseTo(50);
  });

  it('does not flag cost_per_chat increase below 30%', () => {
    const recent = makeWindowMetrics({ cost_per_chat: 0.25 });
    const prior = makeWindowMetrics({ cost_per_chat: 0.20 });

    const anomalies = detectEntityAnomalies(recent, prior);
    const cpcAnomaly = anomalies.find((a) => a.metric === 'cost_per_chat');

    expect(cpcAnomaly).toBeUndefined();
  });

  it('flags chat_rate decrease above 20%', () => {
    const recent = makeWindowMetrics({ chat_rate: 0.60 });
    const prior = makeWindowMetrics({ chat_rate: 0.80 });

    const anomalies = detectEntityAnomalies(recent, prior);
    const chatAnomaly = anomalies.find((a) => a.metric === 'chat_rate');

    expect(chatAnomaly).toBeDefined();
    expect(chatAnomaly!.direction).toBe('decrease');
    expect(chatAnomaly!.changePercent).toBeCloseTo(-25);
  });

  it('does not flag chat_rate decrease below 20%', () => {
    const recent = makeWindowMetrics({ chat_rate: 0.70 });
    const prior = makeWindowMetrics({ chat_rate: 0.80 });

    const anomalies = detectEntityAnomalies(recent, prior);
    const chatAnomaly = anomalies.find((a) => a.metric === 'chat_rate');

    expect(chatAnomaly).toBeUndefined();
  });

  it('flags reveal_rate decrease above 25%', () => {
    const recent = makeWindowMetrics({ reveal_rate: 0.28 });
    const prior = makeWindowMetrics({ reveal_rate: 0.40 });

    const anomalies = detectEntityAnomalies(recent, prior);
    const rrAnomaly = anomalies.find((a) => a.metric === 'reveal_rate');

    expect(rrAnomaly).toBeDefined();
    expect(rrAnomaly!.direction).toBe('decrease');
  });

  it('flags spend increase above 50%', () => {
    const recent = makeWindowMetrics({ spend: 20.0 });
    const prior = makeWindowMetrics({ spend: 10.0 });

    const anomalies = detectEntityAnomalies(recent, prior);
    const spendAnomaly = anomalies.find((a) => a.metric === 'spend');

    expect(spendAnomaly).toBeDefined();
    expect(spendAnomaly!.direction).toBe('increase');
    expect(spendAnomaly!.changePercent).toBeCloseTo(100);
  });
});

// ---------------------------------------------------------------------------
// Direction of Change
// ---------------------------------------------------------------------------

describe('detectEntityAnomalies — direction', () => {
  it('reports increase direction correctly', () => {
    const recent = makeWindowMetrics({ cost_per_chat: 0.40 });
    const prior = makeWindowMetrics({ cost_per_chat: 0.20 });

    const anomalies = detectEntityAnomalies(recent, prior);
    expect(anomalies[0].direction).toBe('increase');
    expect(anomalies[0].changePercent).toBeGreaterThan(0);
  });

  it('reports decrease direction correctly', () => {
    const recent = makeWindowMetrics({ chat_rate: 0.50 });
    const prior = makeWindowMetrics({ chat_rate: 0.80 });

    const anomalies = detectEntityAnomalies(recent, prior);
    const chatAnomaly = anomalies.find((a) => a.metric === 'chat_rate');
    expect(chatAnomaly!.direction).toBe('decrease');
    expect(chatAnomaly!.changePercent).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------
// Severity Classification
// ---------------------------------------------------------------------------

describe('detectEntityAnomalies — severity', () => {
  it('marks critical severity when bad direction exceeds 2x threshold', () => {
    // cost_per_chat threshold is 30%, bad direction is 'increase'
    // 100% increase (2x the base) = critical
    const recent = makeWindowMetrics({ cost_per_chat: 0.40 });
    const prior = makeWindowMetrics({ cost_per_chat: 0.20 });

    const anomalies = detectEntityAnomalies(recent, prior);
    const cpcAnomaly = anomalies.find((a) => a.metric === 'cost_per_chat');
    expect(cpcAnomaly!.severity).toBe('critical');
  });

  it('marks warning severity when change is moderate', () => {
    // 40% increase (>30% but <60%) in cost_per_chat
    const recent = makeWindowMetrics({ cost_per_chat: 0.28 });
    const prior = makeWindowMetrics({ cost_per_chat: 0.20 });

    const anomalies = detectEntityAnomalies(recent, prior);
    const cpcAnomaly = anomalies.find((a) => a.metric === 'cost_per_chat');
    expect(cpcAnomaly!.severity).toBe('warning');
  });

  it('marks improvement direction as warning even if large', () => {
    // cost_per_chat decrease is good (not the bad direction)
    const recent = makeWindowMetrics({ cost_per_chat: 0.10 });
    const prior = makeWindowMetrics({ cost_per_chat: 0.25 });

    const anomalies = detectEntityAnomalies(recent, prior);
    const cpcAnomaly = anomalies.find((a) => a.metric === 'cost_per_chat');
    // -60% change, but direction is 'decrease' which is NOT the bad direction for cost_per_chat
    expect(cpcAnomaly!.severity).toBe('warning');
  });
});

// ---------------------------------------------------------------------------
// Human-readable Messages
// ---------------------------------------------------------------------------

describe('detectEntityAnomalies — messages', () => {
  it('includes concrete values in the message', () => {
    const recent = makeWindowMetrics({ cost_per_chat: 0.40 });
    const prior = makeWindowMetrics({ cost_per_chat: 0.20 });

    const anomalies = detectEntityAnomalies(recent, prior);
    const msg = anomalies[0].message;

    expect(msg).toContain('$0.20');
    expect(msg).toContain('$0.40');
    expect(msg).toContain('ad_001');
    expect(msg).toContain('Cost per Chat');
    expect(msg).toContain('increased');
  });

  it('formats rate metrics as percentages', () => {
    const recent = makeWindowMetrics({ chat_rate: 0.55 });
    const prior = makeWindowMetrics({ chat_rate: 0.82 });

    const anomalies = detectEntityAnomalies(recent, prior);
    const chatAnomaly = anomalies.find((a) => a.metric === 'chat_rate');

    expect(chatAnomaly!.message).toContain('82.0%');
    expect(chatAnomaly!.message).toContain('55.0%');
    expect(chatAnomaly!.message).toContain('dropped');
  });
});

// ---------------------------------------------------------------------------
// Null and Zero Handling
// ---------------------------------------------------------------------------

describe('detectEntityAnomalies — edge cases', () => {
  it('skips metrics with null values', () => {
    const recent = makeWindowMetrics({ cost_per_chat: null });
    const prior = makeWindowMetrics({ cost_per_chat: 0.20 });

    const anomalies = detectEntityAnomalies(recent, prior);
    const cpcAnomaly = anomalies.find((a) => a.metric === 'cost_per_chat');
    expect(cpcAnomaly).toBeUndefined();
  });

  it('skips metrics with zero prior value', () => {
    const recent = makeWindowMetrics({ cost_per_chat: 0.30 });
    const prior = makeWindowMetrics({ cost_per_chat: 0 });

    const anomalies = detectEntityAnomalies(recent, prior);
    const cpcAnomaly = anomalies.find((a) => a.metric === 'cost_per_chat');
    expect(cpcAnomaly).toBeUndefined();
  });

  it('returns empty array when no thresholds are crossed', () => {
    const recent = makeWindowMetrics();
    const prior = makeWindowMetrics();

    const anomalies = detectEntityAnomalies(recent, prior);
    expect(anomalies).toHaveLength(0);
  });

  it('supports custom thresholds', () => {
    const recent = makeWindowMetrics({ cost_per_chat: 0.22 });
    const prior = makeWindowMetrics({ cost_per_chat: 0.20 });

    // 10% change, default threshold is 30% — should not flag
    const anomalies = detectEntityAnomalies(recent, prior);
    expect(anomalies.find((a) => a.metric === 'cost_per_chat')).toBeUndefined();

    // With a 5% threshold — should flag
    const anomaliesLowThreshold = detectEntityAnomalies(recent, prior, {
      ...DEFAULT_ANOMALY_THRESHOLDS,
      costPerChatChangePercent: 5,
    });
    expect(anomaliesLowThreshold.find((a) => a.metric === 'cost_per_chat')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Window Computation
// ---------------------------------------------------------------------------

describe('computeWindows', () => {
  it('computes correct 3-day windows', () => {
    const { recent, prior } = computeWindows('2026-03-21');

    expect(recent.from).toBe('2026-03-19');
    expect(recent.to).toBe('2026-03-21');
    expect(prior.from).toBe('2026-03-16');
    expect(prior.to).toBe('2026-03-18');
  });
});

// ---------------------------------------------------------------------------
// Full Detection Flow
// ---------------------------------------------------------------------------

describe('detectAnomalies', () => {
  it('compares recent vs prior windows across all entities', async () => {
    const recentMetrics: EntityWindowMetrics[] = [
      makeWindowMetrics({ entityId: 'ad_001', cost_per_chat: 0.40 }),
      makeWindowMetrics({ entityId: 'ad_002', cost_per_chat: 0.20 }),
    ];

    const priorMetrics: EntityWindowMetrics[] = [
      makeWindowMetrics({ entityId: 'ad_001', cost_per_chat: 0.20 }),
      makeWindowMetrics({ entityId: 'ad_002', cost_per_chat: 0.19 }),
    ];

    const persistence: AnomalyPersistence = {
      fetchEntityMetrics: vi.fn()
        .mockResolvedValueOnce(recentMetrics)
        .mockResolvedValueOnce(priorMetrics),
    };

    const result = await detectAnomalies(
      persistence,
      { referenceDate: '2026-03-21' },
    );

    expect(result.entitiesChecked).toBe(2);
    expect(result.entitiesFlagged).toBe(1); // only ad_001 has >30% change
    expect(result.anomalies.length).toBeGreaterThanOrEqual(1);
    expect(result.anomalies[0].entityId).toBe('ad_001');
  });

  it('returns zero anomalies when no prior data exists', async () => {
    const persistence: AnomalyPersistence = {
      fetchEntityMetrics: vi.fn()
        .mockResolvedValueOnce([makeWindowMetrics()])
        .mockResolvedValueOnce([]),
    };

    const result = await detectAnomalies(
      persistence,
      { referenceDate: '2026-03-21' },
    );

    expect(result.anomalies).toHaveLength(0);
    expect(result.entitiesFlagged).toBe(0);
  });
});
