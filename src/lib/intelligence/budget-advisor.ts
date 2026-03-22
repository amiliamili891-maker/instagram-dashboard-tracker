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
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a detailed, human-readable rationale from per-metric breakdowns.
 * Shows actual values, what thresholds they crossed, and specific advice.
 */
function buildRationale(
  tier: TierResult,
  entity: BudgetEntityInput,
  action: BudgetAction,
  suggestedSpend: number | null,
): string {
  const lines: string[] = [];

  // Lead with the verdict
  const savings = entity.spend - (suggestedSpend ?? 0);
  if (action === 'pause') {
    lines.push(`PAUSE — this ad is burning $${entity.spend.toFixed(2)}/day at Critical performance. Save $${savings.toFixed(2)}/day.`);
  } else if (action === 'reduce') {
    lines.push(`REDUCE — ${tier.compositeTier} performance. Cut to $${(suggestedSpend ?? 0).toFixed(2)}/day (saves $${savings.toFixed(2)}/day).`);
  } else if (action === 'scale') {
    lines.push(`SCALE — ${tier.compositeTier} performance with headroom. Increase to $${(suggestedSpend ?? 0).toFixed(2)}/day.`);
  } else {
    lines.push(`MAINTAIN — ${tier.compositeTier} performance. Keep at $${entity.spend.toFixed(2)}/day and monitor.`);
  }

  // Per-metric breakdown with actual values
  for (const m of tier.metrics) {
    const icon = TIER_PRIORITY[m.label] >= 4 ? '⚠' : TIER_PRIORITY[m.label] <= 1 ? '✓' : '•';
    lines.push(`${icon} ${m.thresholdExplanation}`);
  }

  // Specific advice based on the driving problem
  if (action === 'pause' || action === 'reduce') {
    const driving = tier.metrics.find(m => m.metric === tier.drivingMetric);
    if (driving) {
      if (driving.metric === 'cost_per_chat' && driving.value !== null) {
        lines.push(`→ Cost per chat ($${driving.value.toFixed(2)}) is the main problem. Check targeting — you may be reaching low-intent audiences.`);
      } else if (driving.metric === 'chat_rate' && driving.value !== null) {
        lines.push(`→ Chat rate (${(driving.value * 100).toFixed(1)}%) is too low. The landing page or creative may not match audience expectations.`);
      } else if (driving.metric === 'reveal_rate' && driving.value !== null) {
        lines.push(`→ Reveal rate (${(driving.value * 100).toFixed(1)}%) is dragging performance. The chat experience or persona may need work.`);
      }
    }
  } else if (action === 'scale') {
    lines.push(`→ All metrics are strong. This ad converts well — increasing budget should yield more chats at a similar cost.`);
  }

  return lines.join('\n');
}

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

    return {
      entityId: entity.entityId,
      entityLevel: entity.entityLevel,
      action,
      currentSpend: entity.spend,
      suggestedSpend,
      rationale: buildRationale(tier, entity, action, suggestedSpend),
      tier,
      urgency: priority,
    };
  }

  // Below Target with meaningful spend -> reduce
  if (priority === 4 && entity.spend >= config.minSpendForPause) {
    const suggestedSpend = entity.spend * 0.7;
    return {
      entityId: entity.entityId,
      entityLevel: entity.entityLevel,
      action: 'reduce',
      currentSpend: entity.spend,
      suggestedSpend,
      rationale: buildRationale(tier, entity, 'reduce', suggestedSpend),
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
        rationale: buildRationale(tier, entity, 'scale', suggestedIncrease),
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
      rationale: buildRationale(tier, entity, 'maintain', null),
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
      rationale: buildRationale(tier, entity, 'maintain', null),
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
