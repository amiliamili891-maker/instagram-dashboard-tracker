/**
 * Budget Advisor
 *
 * Identifies poor/critical spenders (high spend + bad tier) and recommends pause.
 * Identifies strong scale candidates (good tier + low relative spend) and recommends increase.
 * All outputs are advisory only — no automatic Meta actions in v1.
 */

import {
  classifyEntity,
  type EntityMetrics,
  type TierResult,
  TIER_PRIORITY,
  DEFAULT_TIER_CONFIG,
  type TierClassifierConfig,
} from './tier-classifier';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BudgetAction = 'pause' | 'reduce' | 'maintain' | 'increase' | 'scale';

export interface BudgetRecommendation {
  entityId: string;
  entityLevel: 'campaign' | 'adset' | 'ad';
  action: BudgetAction;
  currentSpend: number;
  suggestedSpend: number | null;
  rationale: string;
  tier: TierResult;
  /** Priority ordering: higher = more urgent */
  urgency: number;
}

export interface BudgetResult {
  recommendations: BudgetRecommendation[];
  pauseCandidates: BudgetRecommendation[];
  scaleCandidates: BudgetRecommendation[];
  totalCurrentSpend: number;
  suggestedReallocation: number;
}

export interface BudgetEntityInput extends EntityMetrics {
  spend: number;
}

export interface BudgetPersistence {
  /** Fetch active entities with spend and metrics for the recent period */
  fetchEntitiesWithSpend(): Promise<BudgetEntityInput[]>;
}

export interface BudgetConfig extends TierClassifierConfig {
  /** Minimum daily spend to consider for pause recommendation (default $1) */
  minSpendForPause: number;
  /** Minimum daily spend to consider for scale recommendation (default $0.50) */
  minSpendForScale: number;
}

export const DEFAULT_BUDGET_CONFIG: BudgetConfig = {
  ...DEFAULT_TIER_CONFIG,
  minSpendForPause: 1.0,
  minSpendForScale: 0.5,
};

// ---------------------------------------------------------------------------
// Core Logic
// ---------------------------------------------------------------------------

/**
 * Generate a budget recommendation for a single entity.
 */
export function recommendBudget(
  entity: BudgetEntityInput,
  medianSpend: number,
  config: BudgetConfig = DEFAULT_BUDGET_CONFIG,
): BudgetRecommendation | null {
  const tier = classifyEntity(entity, config);

  // Skip suppressed entities
  if (tier.suppressed) {
    return null;
  }

  const priority = TIER_PRIORITY[tier.compositeTier];

  // Poor or Critical with meaningful spend -> pause/reduce
  if (priority >= 5 && entity.spend >= config.minSpendForPause) {
    const action: BudgetAction = priority >= 6 ? 'pause' : 'reduce';
    const suggestedSpend = action === 'pause' ? 0 : entity.spend * 0.5;
    const savings = entity.spend - suggestedSpend;

    return {
      entityId: entity.entityId,
      entityLevel: entity.entityLevel,
      action,
      currentSpend: entity.spend,
      suggestedSpend,
      rationale:
        `${tier.compositeTier} performance (driven by ${tier.drivingMetric}). ` +
        `Spending $${entity.spend.toFixed(2)}/day with poor returns. ` +
        `${action === 'pause' ? 'Pause' : 'Reduce by 50%'} to save $${savings.toFixed(2)}/day.`,
      tier,
      urgency: priority,
    };
  }

  // Below Target with meaningful spend -> reduce
  if (priority === 4 && entity.spend >= config.minSpendForPause) {
    return {
      entityId: entity.entityId,
      entityLevel: entity.entityLevel,
      action: 'reduce',
      currentSpend: entity.spend,
      suggestedSpend: entity.spend * 0.7,
      rationale:
        `Below Target performance (driven by ${tier.drivingMetric}). ` +
        `Consider reducing spend by 30% until metrics improve.`,
      tier,
      urgency: priority,
    };
  }

  // Perfect/Really Good/Very Good/Great with low relative spend -> scale
  if (priority <= 1 && entity.spend >= config.minSpendForScale) {
    // Scale candidates: good performance, spending below median
    const isUnderSpending = entity.spend < medianSpend * 1.5;
    if (isUnderSpending) {
      const suggestedIncrease = Math.min(entity.spend * 2, medianSpend * 2);
      return {
        entityId: entity.entityId,
        entityLevel: entity.entityLevel,
        action: 'scale',
        currentSpend: entity.spend,
        suggestedSpend: suggestedIncrease,
        rationale:
          `${tier.compositeTier} performance with room to scale. ` +
          `Currently spending $${entity.spend.toFixed(2)}/day — ` +
          `recommend increasing to $${suggestedIncrease.toFixed(2)}/day.`,
        tier,
        urgency: 0,
      };
    }

    return {
      entityId: entity.entityId,
      entityLevel: entity.entityLevel,
      action: 'maintain',
      currentSpend: entity.spend,
      suggestedSpend: null,
      rationale:
        `${tier.compositeTier} performance at good spend level. Maintain current budget.`,
      tier,
      urgency: 0,
    };
  }

  // Good/Okay -> maintain
  if (priority >= 2 && priority <= 3) {
    return {
      entityId: entity.entityId,
      entityLevel: entity.entityLevel,
      action: 'maintain',
      currentSpend: entity.spend,
      suggestedSpend: null,
      rationale:
        `${tier.compositeTier} performance. Maintain current budget and monitor.`,
      tier,
      urgency: priority,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main Advisor
// ---------------------------------------------------------------------------

/**
 * Generate budget recommendations for all active entities.
 */
export async function generateBudgetRecommendations(
  persistence: BudgetPersistence,
  config: BudgetConfig = DEFAULT_BUDGET_CONFIG,
): Promise<BudgetResult> {
  const entities = await persistence.fetchEntitiesWithSpend();

  // Calculate median spend for relative comparisons
  const spends = entities.map((e) => e.spend).filter((s) => s > 0).sort((a, b) => a - b);
  const medianSpend = spends.length > 0
    ? spends[Math.floor(spends.length / 2)]
    : 0;

  const recommendations: BudgetRecommendation[] = [];

  for (const entity of entities) {
    const rec = recommendBudget(entity, medianSpend, config);
    if (rec) {
      recommendations.push(rec);
    }
  }

  // Sort by urgency descending (most urgent first)
  recommendations.sort((a, b) => b.urgency - a.urgency);

  const pauseCandidates = recommendations.filter(
    (r) => r.action === 'pause' || r.action === 'reduce',
  );
  const scaleCandidates = recommendations.filter(
    (r) => r.action === 'scale' || r.action === 'increase',
  );

  const totalCurrentSpend = entities.reduce((sum, e) => sum + e.spend, 0);
  const suggestedReallocation = pauseCandidates.reduce(
    (sum, r) => sum + (r.currentSpend - (r.suggestedSpend ?? 0)),
    0,
  );

  return {
    recommendations,
    pauseCandidates,
    scaleCandidates,
    totalCurrentSpend,
    suggestedReallocation,
  };
}
