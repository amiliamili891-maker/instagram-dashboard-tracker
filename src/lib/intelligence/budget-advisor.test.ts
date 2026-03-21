/**
 * Tests for Budget Advisor
 *
 * Covers:
 *   - Pause recommendations for poor/critical performers
 *   - Scale recommendations for strong performers
 *   - Reduce recommendations for below-target performers
 *   - Maintain recommendations for okay performers
 *   - Suppressed entity handling
 *   - Full recommendation flow
 */

import { describe, it, expect, vi } from 'vitest';
import {
  recommendBudget,
  generateBudgetRecommendations,
  type BudgetEntityInput,
  type BudgetPersistence,
  DEFAULT_BUDGET_CONFIG,
} from './budget-advisor';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeEntity(overrides: Partial<BudgetEntityInput> = {}): BudgetEntityInput {
  return {
    entityId: 'ad_001',
    entityLevel: 'ad',
    spend: 10.0,
    visits: 200,
    chat_rate: 0.82,
    cost_per_chat: 0.25,
    reveal_rate: 0.35,
    freshnessState: 'fresh',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Pause/Reduce Recommendations
// ---------------------------------------------------------------------------

describe('recommendBudget — pause/reduce', () => {
  it('recommends pause for Critical tier with high spend', () => {
    const entity = makeEntity({
      chat_rate: 0.30,       // Critical
      cost_per_chat: 0.70,   // Critical
      reveal_rate: 0.15,     // Critical
      spend: 15.0,
    });

    const rec = recommendBudget(entity, 10.0);

    expect(rec).not.toBeNull();
    expect(rec!.action).toBe('pause');
    expect(rec!.suggestedSpend).toBe(0);
    expect(rec!.rationale).toContain('Critical');
    expect(rec!.urgency).toBe(6);
  });

  it('recommends reduce for Poor tier with meaningful spend', () => {
    const entity = makeEntity({
      chat_rate: 0.45,       // Poor
      cost_per_chat: 0.55,   // Poor
      reveal_rate: 0.22,     // Below Target
      spend: 8.0,
    });

    const rec = recommendBudget(entity, 10.0);

    expect(rec).not.toBeNull();
    expect(rec!.action).toBe('reduce');
    expect(rec!.suggestedSpend).toBe(4.0); // 50% reduction
    expect(rec!.rationale).toContain('Poor');
  });

  it('recommends reduce for Below Target tier', () => {
    const entity = makeEntity({
      chat_rate: 0.55,       // Below Target
      cost_per_chat: 0.45,   // Below Target
      reveal_rate: 0.22,     // Below Target
      spend: 5.0,
    });

    const rec = recommendBudget(entity, 10.0);

    expect(rec).not.toBeNull();
    expect(rec!.action).toBe('reduce');
    expect(rec!.suggestedSpend).toBeCloseTo(3.5); // 30% reduction
    expect(rec!.rationale).toContain('Below Target');
  });

  it('does not recommend pause for low spend Critical', () => {
    const entity = makeEntity({
      chat_rate: 0.30,       // Critical
      cost_per_chat: 0.70,   // Critical
      spend: 0.50,           // Below minSpendForPause
    });

    const rec = recommendBudget(entity, 10.0);

    // Low spend + critical — no actionable recommendation since spend is negligible
    expect(rec === null || rec.action !== 'pause').toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Scale Recommendations
// ---------------------------------------------------------------------------

describe('recommendBudget — scale', () => {
  it('recommends scale for Perfect tier with low relative spend', () => {
    const entity = makeEntity({
      chat_rate: 0.90,       // Perfect
      cost_per_chat: 0.15,   // Perfect
      reveal_rate: 0.45,     // Perfect
      spend: 5.0,
    });
    const medianSpend = 10.0;

    const rec = recommendBudget(entity, medianSpend);

    expect(rec).not.toBeNull();
    expect(rec!.action).toBe('scale');
    expect(rec!.suggestedSpend).toBeGreaterThan(rec!.currentSpend);
    expect(rec!.rationale).toContain('Perfect');
    expect(rec!.rationale).toContain('scale');
  });

  it('recommends maintain for Perfect tier already at high spend', () => {
    const entity = makeEntity({
      chat_rate: 0.90,       // Perfect
      cost_per_chat: 0.15,   // Perfect
      reveal_rate: 0.45,     // Perfect
      spend: 25.0,           // Well above median * 1.5
    });
    const medianSpend = 10.0;

    const rec = recommendBudget(entity, medianSpend);

    expect(rec).not.toBeNull();
    expect(rec!.action).toBe('maintain');
  });
});

// ---------------------------------------------------------------------------
// Maintain Recommendations
// ---------------------------------------------------------------------------

describe('recommendBudget — maintain', () => {
  it('recommends maintain for Okay tier', () => {
    const entity = makeEntity({
      chat_rate: 0.70,       // Okay
      cost_per_chat: 0.35,   // Good-Okay
      reveal_rate: 0.27,     // Okay
      spend: 8.0,
    });

    const rec = recommendBudget(entity, 10.0);

    expect(rec).not.toBeNull();
    expect(rec!.action).toBe('maintain');
    expect(rec!.suggestedSpend).toBeNull();
  });

  it('recommends maintain for Good tier', () => {
    const entity = makeEntity({
      chat_rate: 0.76,       // Good
      cost_per_chat: 0.35,   // Good-Okay
      reveal_rate: 0.32,     // Good
      spend: 8.0,
    });

    const rec = recommendBudget(entity, 10.0);

    expect(rec).not.toBeNull();
    expect(rec!.action).toBe('maintain');
  });
});

// ---------------------------------------------------------------------------
// Suppressed Entities
// ---------------------------------------------------------------------------

describe('recommendBudget — suppression', () => {
  it('returns null for suppressed entities (insufficient data)', () => {
    const entity = makeEntity({ visits: 10 });
    const rec = recommendBudget(entity, 10.0);
    expect(rec).toBeNull();
  });

  it('returns null for stale freshness', () => {
    const entity = makeEntity({ freshnessState: 'stale' });
    const rec = recommendBudget(entity, 10.0);
    expect(rec).toBeNull();
  });

  it('returns null for degraded freshness', () => {
    const entity = makeEntity({ freshnessState: 'degraded' });
    const rec = recommendBudget(entity, 10.0);
    expect(rec).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Full Flow
// ---------------------------------------------------------------------------

describe('generateBudgetRecommendations', () => {
  it('generates recommendations and separates pause/scale candidates', async () => {
    const entities: BudgetEntityInput[] = [
      // Perfect — scale candidate
      makeEntity({
        entityId: 'ad_good',
        chat_rate: 0.90,
        cost_per_chat: 0.15,
        reveal_rate: 0.45,
        spend: 5.0,
      }),
      // Critical — pause candidate
      makeEntity({
        entityId: 'ad_bad',
        chat_rate: 0.30,
        cost_per_chat: 0.70,
        reveal_rate: 0.15,
        spend: 12.0,
      }),
      // Okay — maintain
      makeEntity({
        entityId: 'ad_mid',
        chat_rate: 0.70,
        cost_per_chat: 0.35,
        reveal_rate: 0.27,
        spend: 8.0,
      }),
    ];

    const persistence: BudgetPersistence = {
      fetchEntitiesWithSpend: vi.fn().mockResolvedValue(entities),
    };

    const result = await generateBudgetRecommendations(persistence);

    expect(result.recommendations.length).toBeGreaterThanOrEqual(3);
    expect(result.pauseCandidates.length).toBeGreaterThanOrEqual(1);
    expect(result.scaleCandidates.length).toBeGreaterThanOrEqual(1);
    expect(result.totalCurrentSpend).toBe(25.0);
    expect(result.suggestedReallocation).toBeGreaterThan(0);

    // Sorted by urgency descending
    for (let i = 1; i < result.recommendations.length; i++) {
      expect(result.recommendations[i - 1].urgency).toBeGreaterThanOrEqual(
        result.recommendations[i].urgency,
      );
    }
  });

  it('returns empty results when all entities are suppressed', async () => {
    const entities: BudgetEntityInput[] = [
      makeEntity({ entityId: 'ad_001', visits: 10 }),
      makeEntity({ entityId: 'ad_002', freshnessState: 'stale' }),
    ];

    const persistence: BudgetPersistence = {
      fetchEntitiesWithSpend: vi.fn().mockResolvedValue(entities),
    };

    const result = await generateBudgetRecommendations(persistence);

    expect(result.recommendations).toHaveLength(0);
    expect(result.pauseCandidates).toHaveLength(0);
    expect(result.scaleCandidates).toHaveLength(0);
  });
});
