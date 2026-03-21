/**
 * Tests for Tier Classifier
 *
 * Covers:
 *   - Threshold boundary values for all three metrics
 *   - Insufficient-data suppression (freshness + sample size)
 *   - Composite tier = worst-of across metrics
 *   - Explanation payload generation
 *   - runTierClassification full flow
 */

import { describe, it, expect, vi } from 'vitest';
import {
  classifyEntity,
  runTierClassification,
  type EntityMetrics,
  type TierPersistence,
  type TierResult,
  DEFAULT_TIER_CONFIG,
} from './tier-classifier';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeMetrics(overrides: Partial<EntityMetrics> = {}): EntityMetrics {
  return {
    entityId: 'ad_001',
    entityLevel: 'ad',
    chat_rate: 0.82,       // 82% → Really Good
    cost_per_chat: 0.25,   // $0.25 → Very Good
    reveal_rate: 0.35,     // 35% → Great
    visits: 100,
    freshnessState: 'fresh',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Chat Rate Threshold Boundaries
// ---------------------------------------------------------------------------

describe('classifyEntity — chat_rate thresholds', () => {
  it('classifies 85% as Perfect', () => {
    const result = classifyEntity(makeMetrics({ chat_rate: 0.85 }));
    const chatMetric = result.metrics.find((m) => m.metric === 'chat_rate');
    expect(chatMetric?.label).toBe('Perfect');
    expect(chatMetric?.action).toBe('Scale');
  });

  it('classifies 84% as Really Good', () => {
    const result = classifyEntity(makeMetrics({ chat_rate: 0.84 }));
    const chatMetric = result.metrics.find((m) => m.metric === 'chat_rate');
    expect(chatMetric?.label).toBe('Really Good');
  });

  it('classifies 80% as Really Good', () => {
    const result = classifyEntity(makeMetrics({ chat_rate: 0.80 }));
    const chatMetric = result.metrics.find((m) => m.metric === 'chat_rate');
    expect(chatMetric?.label).toBe('Really Good');
  });

  it('classifies 79% as Good', () => {
    const result = classifyEntity(makeMetrics({ chat_rate: 0.79 }));
    const chatMetric = result.metrics.find((m) => m.metric === 'chat_rate');
    expect(chatMetric?.label).toBe('Good');
    expect(chatMetric?.action).toBe('Maintain');
  });

  it('classifies 75% as Good', () => {
    const result = classifyEntity(makeMetrics({ chat_rate: 0.75 }));
    const chatMetric = result.metrics.find((m) => m.metric === 'chat_rate');
    expect(chatMetric?.label).toBe('Good');
  });

  it('classifies 74% as Okay', () => {
    const result = classifyEntity(makeMetrics({ chat_rate: 0.74 }));
    const chatMetric = result.metrics.find((m) => m.metric === 'chat_rate');
    expect(chatMetric?.label).toBe('Okay');
    expect(chatMetric?.action).toBe('Maintain');
  });

  it('classifies 65% as Okay', () => {
    const result = classifyEntity(makeMetrics({ chat_rate: 0.65 }));
    const chatMetric = result.metrics.find((m) => m.metric === 'chat_rate');
    expect(chatMetric?.label).toBe('Okay');
  });

  it('classifies 64% as Below Target', () => {
    const result = classifyEntity(makeMetrics({ chat_rate: 0.64 }));
    const chatMetric = result.metrics.find((m) => m.metric === 'chat_rate');
    expect(chatMetric?.label).toBe('Below Target');
    expect(chatMetric?.action).toBe('Monitor');
  });

  it('classifies 50% as Below Target', () => {
    const result = classifyEntity(makeMetrics({ chat_rate: 0.50 }));
    const chatMetric = result.metrics.find((m) => m.metric === 'chat_rate');
    expect(chatMetric?.label).toBe('Below Target');
  });

  it('classifies 49% as Poor', () => {
    const result = classifyEntity(makeMetrics({ chat_rate: 0.49 }));
    const chatMetric = result.metrics.find((m) => m.metric === 'chat_rate');
    expect(chatMetric?.label).toBe('Poor');
    expect(chatMetric?.action).toBe('Flag');
  });

  it('classifies 40% as Poor', () => {
    const result = classifyEntity(makeMetrics({ chat_rate: 0.40 }));
    const chatMetric = result.metrics.find((m) => m.metric === 'chat_rate');
    expect(chatMetric?.label).toBe('Poor');
  });

  it('classifies 39% as Critical', () => {
    const result = classifyEntity(makeMetrics({ chat_rate: 0.39 }));
    const chatMetric = result.metrics.find((m) => m.metric === 'chat_rate');
    expect(chatMetric?.label).toBe('Critical');
    expect(chatMetric?.action).toBe('Disband');
  });
});

// ---------------------------------------------------------------------------
// Cost Per Chat Threshold Boundaries
// ---------------------------------------------------------------------------

describe('classifyEntity — cost_per_chat thresholds', () => {
  it('classifies $0.20 as Perfect', () => {
    const result = classifyEntity(makeMetrics({ cost_per_chat: 0.20 }));
    const cpcMetric = result.metrics.find((m) => m.metric === 'cost_per_chat');
    expect(cpcMetric?.label).toBe('Perfect');
    expect(cpcMetric?.action).toBe('Scale');
  });

  it('classifies $0.21 as Very Good', () => {
    const result = classifyEntity(makeMetrics({ cost_per_chat: 0.21 }));
    const cpcMetric = result.metrics.find((m) => m.metric === 'cost_per_chat');
    expect(cpcMetric?.label).toBe('Very Good');
  });

  it('classifies $0.30 as Very Good', () => {
    const result = classifyEntity(makeMetrics({ cost_per_chat: 0.30 }));
    const cpcMetric = result.metrics.find((m) => m.metric === 'cost_per_chat');
    expect(cpcMetric?.label).toBe('Very Good');
  });

  it('classifies $0.31 as Good-Okay', () => {
    const result = classifyEntity(makeMetrics({ cost_per_chat: 0.31 }));
    const cpcMetric = result.metrics.find((m) => m.metric === 'cost_per_chat');
    expect(cpcMetric?.label).toBe('Good-Okay');
    expect(cpcMetric?.action).toBe('Maintain');
  });

  it('classifies $0.40 as Good-Okay', () => {
    const result = classifyEntity(makeMetrics({ cost_per_chat: 0.40 }));
    const cpcMetric = result.metrics.find((m) => m.metric === 'cost_per_chat');
    expect(cpcMetric?.label).toBe('Good-Okay');
  });

  it('classifies $0.41 as Below Target', () => {
    const result = classifyEntity(makeMetrics({ cost_per_chat: 0.41 }));
    const cpcMetric = result.metrics.find((m) => m.metric === 'cost_per_chat');
    expect(cpcMetric?.label).toBe('Below Target');
    expect(cpcMetric?.action).toBe('Monitor');
  });

  it('classifies $0.50 as Below Target', () => {
    const result = classifyEntity(makeMetrics({ cost_per_chat: 0.50 }));
    const cpcMetric = result.metrics.find((m) => m.metric === 'cost_per_chat');
    expect(cpcMetric?.label).toBe('Below Target');
  });

  it('classifies $0.51 as Poor', () => {
    const result = classifyEntity(makeMetrics({ cost_per_chat: 0.51 }));
    const cpcMetric = result.metrics.find((m) => m.metric === 'cost_per_chat');
    expect(cpcMetric?.label).toBe('Poor');
    expect(cpcMetric?.action).toBe('Flag');
  });

  it('classifies $0.60 as Poor', () => {
    const result = classifyEntity(makeMetrics({ cost_per_chat: 0.60 }));
    const cpcMetric = result.metrics.find((m) => m.metric === 'cost_per_chat');
    expect(cpcMetric?.label).toBe('Poor');
  });

  it('classifies $0.61 as Critical', () => {
    const result = classifyEntity(makeMetrics({ cost_per_chat: 0.61 }));
    const cpcMetric = result.metrics.find((m) => m.metric === 'cost_per_chat');
    expect(cpcMetric?.label).toBe('Critical');
    expect(cpcMetric?.action).toBe('Disband');
  });
});

// ---------------------------------------------------------------------------
// Reveal Rate Threshold Boundaries
// ---------------------------------------------------------------------------

describe('classifyEntity — reveal_rate thresholds', () => {
  it('classifies 40% as Perfect', () => {
    const result = classifyEntity(makeMetrics({ reveal_rate: 0.40 }));
    const rrMetric = result.metrics.find((m) => m.metric === 'reveal_rate');
    expect(rrMetric?.label).toBe('Perfect');
    expect(rrMetric?.action).toBe('Scale');
  });

  it('classifies 39% as Great', () => {
    const result = classifyEntity(makeMetrics({ reveal_rate: 0.39 }));
    const rrMetric = result.metrics.find((m) => m.metric === 'reveal_rate');
    expect(rrMetric?.label).toBe('Great');
    expect(rrMetric?.action).toBe('Scale');
  });

  it('classifies 35% as Great', () => {
    const result = classifyEntity(makeMetrics({ reveal_rate: 0.35 }));
    const rrMetric = result.metrics.find((m) => m.metric === 'reveal_rate');
    expect(rrMetric?.label).toBe('Great');
  });

  it('classifies 34% as Good', () => {
    const result = classifyEntity(makeMetrics({ reveal_rate: 0.34 }));
    const rrMetric = result.metrics.find((m) => m.metric === 'reveal_rate');
    expect(rrMetric?.label).toBe('Good');
    expect(rrMetric?.action).toBe('Maintain');
  });

  it('classifies 30% as Good', () => {
    const result = classifyEntity(makeMetrics({ reveal_rate: 0.30 }));
    const rrMetric = result.metrics.find((m) => m.metric === 'reveal_rate');
    expect(rrMetric?.label).toBe('Good');
  });

  it('classifies 29% as Okay', () => {
    const result = classifyEntity(makeMetrics({ reveal_rate: 0.29 }));
    const rrMetric = result.metrics.find((m) => m.metric === 'reveal_rate');
    expect(rrMetric?.label).toBe('Okay');
    expect(rrMetric?.action).toBe('Maintain');
  });

  it('classifies 25% as Okay', () => {
    const result = classifyEntity(makeMetrics({ reveal_rate: 0.25 }));
    const rrMetric = result.metrics.find((m) => m.metric === 'reveal_rate');
    expect(rrMetric?.label).toBe('Okay');
  });

  it('classifies 24% as Below Target', () => {
    const result = classifyEntity(makeMetrics({ reveal_rate: 0.24 }));
    const rrMetric = result.metrics.find((m) => m.metric === 'reveal_rate');
    expect(rrMetric?.label).toBe('Below Target');
    expect(rrMetric?.action).toBe('Flag');
  });

  it('classifies 20% as Below Target', () => {
    const result = classifyEntity(makeMetrics({ reveal_rate: 0.20 }));
    const rrMetric = result.metrics.find((m) => m.metric === 'reveal_rate');
    expect(rrMetric?.label).toBe('Below Target');
  });

  it('classifies 19% as Critical', () => {
    const result = classifyEntity(makeMetrics({ reveal_rate: 0.19 }));
    const rrMetric = result.metrics.find((m) => m.metric === 'reveal_rate');
    expect(rrMetric?.label).toBe('Critical');
    expect(rrMetric?.action).toBe('Disband');
  });
});

// ---------------------------------------------------------------------------
// Composite Tier (Worst-Of)
// ---------------------------------------------------------------------------

describe('classifyEntity — composite tier', () => {
  it('uses worst metric for composite tier', () => {
    // chat_rate: Perfect, cost_per_chat: Critical, reveal_rate: Perfect
    const result = classifyEntity(makeMetrics({
      chat_rate: 0.90,        // Perfect
      cost_per_chat: 0.70,    // Critical
      reveal_rate: 0.45,      // Perfect
    }));
    expect(result.compositeTier).toBe('Critical');
    expect(result.compositeColor).toBe('red');
    expect(result.compositeAction).toBe('Disband');
    expect(result.drivingMetric).toBe('cost_per_chat');
  });

  it('returns Perfect when all metrics are perfect', () => {
    const result = classifyEntity(makeMetrics({
      chat_rate: 0.90,
      cost_per_chat: 0.15,
      reveal_rate: 0.45,
    }));
    expect(result.compositeTier).toBe('Perfect');
    expect(result.compositeColor).toBe('green');
    expect(result.compositeAction).toBe('Scale');
  });

  it('picks the single worst metric when multiple are bad', () => {
    // chat_rate: Poor, cost_per_chat: Below Target, reveal_rate: Critical
    const result = classifyEntity(makeMetrics({
      chat_rate: 0.45,        // Poor
      cost_per_chat: 0.45,    // Below Target
      reveal_rate: 0.15,      // Critical
    }));
    expect(result.compositeTier).toBe('Critical');
    expect(result.drivingMetric).toBe('reveal_rate');
  });

  it('handles null metrics gracefully — only classifies non-null', () => {
    const result = classifyEntity(makeMetrics({
      chat_rate: 0.85,
      cost_per_chat: null,
      reveal_rate: null,
    }));
    expect(result.compositeTier).toBe('Perfect');
    expect(result.metrics).toHaveLength(1);
    expect(result.metrics[0].metric).toBe('chat_rate');
  });
});

// ---------------------------------------------------------------------------
// Insufficient Data Suppression
// ---------------------------------------------------------------------------

describe('classifyEntity — suppression', () => {
  it('suppresses when freshness is degraded', () => {
    const result = classifyEntity(makeMetrics({ freshnessState: 'degraded' }));
    expect(result.suppressed).toBe(true);
    expect(result.compositeTier).toBe('Insufficient Data');
    expect(result.compositeColor).toBe('gray');
    expect(result.compositeAction).toBe('None');
    expect(result.suppressionReason).toContain('degraded');
  });

  it('suppresses when freshness is stale', () => {
    const result = classifyEntity(makeMetrics({ freshnessState: 'stale' }));
    expect(result.suppressed).toBe(true);
    expect(result.compositeTier).toBe('Insufficient Data');
    expect(result.suppressionReason).toContain('stale');
  });

  it('suppresses when visits below minimum sample size', () => {
    const result = classifyEntity(makeMetrics({ visits: 10 }));
    expect(result.suppressed).toBe(true);
    expect(result.compositeTier).toBe('Insufficient Data');
    expect(result.suppressionReason).toContain('10 visits');
    expect(result.suppressionReason).toContain('minimum 50');
  });

  it('uses configurable minimum sample size', () => {
    const result = classifyEntity(
      makeMetrics({ visits: 90 }),
      { minSampleSize: 100 },
    );
    expect(result.suppressed).toBe(true);
    expect(result.suppressionReason).toContain('minimum 100');
  });

  it('does not suppress at exactly the minimum sample size', () => {
    const result = classifyEntity(makeMetrics({ visits: 50 }));
    expect(result.suppressed).toBe(false);
  });

  it('suppresses when all metrics are null', () => {
    const result = classifyEntity(makeMetrics({
      chat_rate: null,
      cost_per_chat: null,
      reveal_rate: null,
    }));
    expect(result.suppressed).toBe(true);
    expect(result.suppressionReason).toContain('All metrics are null');
  });
});

// ---------------------------------------------------------------------------
// Explanation Payloads
// ---------------------------------------------------------------------------

describe('classifyEntity — explanation metadata', () => {
  it('includes threshold explanation for each metric', () => {
    const result = classifyEntity(makeMetrics({
      chat_rate: 0.55,
      cost_per_chat: 0.35,
      reveal_rate: 0.32,
    }));

    expect(result.metrics).toHaveLength(3);
    for (const metric of result.metrics) {
      expect(metric.thresholdExplanation).toBeTruthy();
      expect(typeof metric.thresholdExplanation).toBe('string');
    }

    const chatExplanation = result.metrics.find((m) => m.metric === 'chat_rate');
    expect(chatExplanation?.thresholdExplanation).toContain('55.0%');
    expect(chatExplanation?.thresholdExplanation).toContain('Below Target');
  });

  it('includes value in explanation for cost_per_chat', () => {
    const result = classifyEntity(makeMetrics({ cost_per_chat: 0.55 }));
    const cpcMetric = result.metrics.find((m) => m.metric === 'cost_per_chat');
    expect(cpcMetric?.thresholdExplanation).toContain('$0.55');
    expect(cpcMetric?.thresholdExplanation).toContain('Poor');
  });

  it('tracks driving metric and sample size', () => {
    const result = classifyEntity(makeMetrics({ visits: 200 }));
    expect(result.sampleSize).toBe(200);
    expect(result.drivingMetric).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// runTierClassification
// ---------------------------------------------------------------------------

describe('runTierClassification', () => {
  it('classifies all entities and returns counts', async () => {
    const mockPersistence: TierPersistence = {
      fetchActiveEntities: vi.fn().mockResolvedValue([
        makeMetrics({ entityId: 'ad_001', visits: 100 }),
        makeMetrics({ entityId: 'ad_002', visits: 30 }), // below threshold
        makeMetrics({ entityId: 'ad_003', visits: 200, freshnessState: 'stale' }),
      ]),
      upsertTierAlerts: vi.fn().mockResolvedValue(3),
    };

    const result = await runTierClassification(mockPersistence);

    expect(result.classified).toBe(3);
    expect(result.suppressed).toBe(2); // visits < 50 + stale
    expect(result.alerts).toHaveLength(3);
    expect(mockPersistence.upsertTierAlerts).toHaveBeenCalledWith(result.alerts);
  });

  it('uses custom config for sample size', async () => {
    const mockPersistence: TierPersistence = {
      fetchActiveEntities: vi.fn().mockResolvedValue([
        makeMetrics({ entityId: 'ad_001', visits: 80 }),
      ]),
      upsertTierAlerts: vi.fn().mockResolvedValue(1),
    };

    const result = await runTierClassification(mockPersistence, { minSampleSize: 100 });
    expect(result.suppressed).toBe(1);
  });
});
