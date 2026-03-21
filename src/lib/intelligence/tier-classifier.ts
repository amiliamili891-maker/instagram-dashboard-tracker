/**
 * Tier Classifier — Explainable Performance Tiering
 *
 * Evaluates every ad, adset, and campaign against three threshold tables
 * (chat_rate, cost_per_chat, reveal_rate). Each entity receives a composite
 * tier equal to the worst rating across the three metrics.
 *
 * Tier output includes label, color, recommended action, and explanation
 * metadata showing which metric caused the tier and what threshold was crossed.
 *
 * Suppresses to "Insufficient data" when freshness is degraded/stale or
 * minimum sample size is not met (configurable, default 50 visits).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TierLabel =
  | 'Perfect'
  | 'Really Good'
  | 'Very Good'
  | 'Great'
  | 'Good'
  | 'Good-Okay'
  | 'Okay'
  | 'Below Target'
  | 'Poor'
  | 'Critical'
  | 'Insufficient Data';

export type TierColor = 'green' | 'yellow' | 'orange' | 'red' | 'gray';

export type TierAction = 'Scale' | 'Maintain' | 'Monitor' | 'Flag' | 'Disband' | 'None';

/** Priority ordering — higher number = worse tier */
export const TIER_PRIORITY: Record<TierLabel, number> = {
  'Perfect': 0,
  'Really Good': 1,
  'Very Good': 1,
  'Great': 1,
  'Good': 2,
  'Good-Okay': 2,
  'Okay': 3,
  'Below Target': 4,
  'Poor': 5,
  'Critical': 6,
  'Insufficient Data': -1,
};

export interface MetricTierResult {
  metric: string;
  value: number | null;
  label: TierLabel;
  color: TierColor;
  action: TierAction;
  /** Human-readable explanation of the threshold crossed */
  thresholdExplanation: string;
}

export interface TierResult {
  entityId: string;
  entityLevel: 'campaign' | 'adset' | 'ad';
  compositeTier: TierLabel;
  compositeColor: TierColor;
  compositeAction: TierAction;
  /** Which metric caused the composite tier (worst-of) */
  drivingMetric: string;
  /** Per-metric breakdowns */
  metrics: MetricTierResult[];
  /** Sample size used */
  sampleSize: number;
  /** Was the result suppressed? */
  suppressed: boolean;
  suppressionReason: string | null;
}

/** Metrics input for classification */
export interface EntityMetrics {
  entityId: string;
  entityLevel: 'campaign' | 'adset' | 'ad';
  chat_rate: number | null;
  cost_per_chat: number | null;
  reveal_rate: number | null;
  visits: number;
  freshnessState: 'fresh' | 'degraded' | 'stale' | null;
}

export interface TierClassifierConfig {
  /** Minimum visits required for classification (default 50) */
  minSampleSize: number;
}

export const DEFAULT_TIER_CONFIG: TierClassifierConfig = {
  minSampleSize: 50,
};

// ---------------------------------------------------------------------------
// Threshold Tables — from PRD
// ---------------------------------------------------------------------------

interface ThresholdEntry {
  label: TierLabel;
  color: TierColor;
  action: TierAction;
}

/**
 * Chat Rate thresholds (higher is better).
 * Ranges are checked top-down, first match wins.
 */
function classifyChatRate(value: number): MetricTierResult {
  const pct = value * 100; // value is 0-1 fraction

  let entry: ThresholdEntry;
  let explanation: string;

  if (pct >= 85) {
    entry = { label: 'Perfect', color: 'green', action: 'Scale' };
    explanation = `Chat rate ${pct.toFixed(1)}% is >= 85% (Perfect)`;
  } else if (pct >= 80) {
    entry = { label: 'Really Good', color: 'green', action: 'Scale' };
    explanation = `Chat rate ${pct.toFixed(1)}% is 80-84% (Really Good)`;
  } else if (pct >= 75) {
    entry = { label: 'Good', color: 'green', action: 'Maintain' };
    explanation = `Chat rate ${pct.toFixed(1)}% is 75-79% (Good)`;
  } else if (pct >= 65) {
    entry = { label: 'Okay', color: 'yellow', action: 'Maintain' };
    explanation = `Chat rate ${pct.toFixed(1)}% is 65-74% (Okay)`;
  } else if (pct >= 50) {
    entry = { label: 'Below Target', color: 'orange', action: 'Monitor' };
    explanation = `Chat rate ${pct.toFixed(1)}% is 50-64% (Below Target)`;
  } else if (pct >= 40) {
    entry = { label: 'Poor', color: 'red', action: 'Flag' };
    explanation = `Chat rate ${pct.toFixed(1)}% is 40-49% (Poor)`;
  } else {
    entry = { label: 'Critical', color: 'red', action: 'Disband' };
    explanation = `Chat rate ${pct.toFixed(1)}% is < 40% (Critical)`;
  }

  return {
    metric: 'chat_rate',
    value,
    label: entry.label,
    color: entry.color,
    action: entry.action,
    thresholdExplanation: explanation,
  };
}

/**
 * Cost Per Chat thresholds (lower is better).
 */
function classifyCostPerChat(value: number): MetricTierResult {
  let entry: ThresholdEntry;
  let explanation: string;

  if (value <= 0.20) {
    entry = { label: 'Perfect', color: 'green', action: 'Scale' };
    explanation = `Cost per chat $${value.toFixed(2)} is <= $0.20 (Perfect)`;
  } else if (value <= 0.30) {
    entry = { label: 'Very Good', color: 'green', action: 'Scale' };
    explanation = `Cost per chat $${value.toFixed(2)} is $0.21-$0.30 (Very Good)`;
  } else if (value <= 0.40) {
    entry = { label: 'Good-Okay', color: 'yellow', action: 'Maintain' };
    explanation = `Cost per chat $${value.toFixed(2)} is $0.31-$0.40 (Good-Okay)`;
  } else if (value <= 0.50) {
    entry = { label: 'Below Target', color: 'orange', action: 'Monitor' };
    explanation = `Cost per chat $${value.toFixed(2)} is $0.41-$0.50 (Below Target)`;
  } else if (value <= 0.60) {
    entry = { label: 'Poor', color: 'red', action: 'Flag' };
    explanation = `Cost per chat $${value.toFixed(2)} is $0.51-$0.60 (Poor)`;
  } else {
    entry = { label: 'Critical', color: 'red', action: 'Disband' };
    explanation = `Cost per chat $${value.toFixed(2)} is > $0.60 (Critical)`;
  }

  return {
    metric: 'cost_per_chat',
    value,
    label: entry.label,
    color: entry.color,
    action: entry.action,
    thresholdExplanation: explanation,
  };
}

/**
 * Reveal Rate thresholds (higher is better).
 */
function classifyRevealRate(value: number): MetricTierResult {
  const pct = value * 100; // value is 0-1 fraction

  let entry: ThresholdEntry;
  let explanation: string;

  if (pct >= 40) {
    entry = { label: 'Perfect', color: 'green', action: 'Scale' };
    explanation = `Reveal rate ${pct.toFixed(1)}% is >= 40% (Perfect)`;
  } else if (pct >= 35) {
    entry = { label: 'Great', color: 'green', action: 'Scale' };
    explanation = `Reveal rate ${pct.toFixed(1)}% is 35-39% (Great)`;
  } else if (pct >= 30) {
    entry = { label: 'Good', color: 'green', action: 'Maintain' };
    explanation = `Reveal rate ${pct.toFixed(1)}% is 30-34% (Good)`;
  } else if (pct >= 25) {
    entry = { label: 'Okay', color: 'yellow', action: 'Maintain' };
    explanation = `Reveal rate ${pct.toFixed(1)}% is 25-29% (Okay)`;
  } else if (pct >= 20) {
    entry = { label: 'Below Target', color: 'orange', action: 'Flag' };
    explanation = `Reveal rate ${pct.toFixed(1)}% is 20-24% (Below Target)`;
  } else {
    entry = { label: 'Critical', color: 'red', action: 'Disband' };
    explanation = `Reveal rate ${pct.toFixed(1)}% is < 20% (Critical)`;
  }

  return {
    metric: 'reveal_rate',
    value,
    label: entry.label,
    color: entry.color,
    action: entry.action,
    thresholdExplanation: explanation,
  };
}

// ---------------------------------------------------------------------------
// Main Classifier
// ---------------------------------------------------------------------------

/**
 * Classify a single entity's metrics into a composite tier.
 * Returns the worst tier across chat_rate, cost_per_chat, and reveal_rate.
 */
export function classifyEntity(
  metrics: EntityMetrics,
  config: TierClassifierConfig = DEFAULT_TIER_CONFIG,
): TierResult {
  const base: Pick<TierResult, 'entityId' | 'entityLevel' | 'sampleSize'> = {
    entityId: metrics.entityId,
    entityLevel: metrics.entityLevel,
    sampleSize: metrics.visits,
  };

  // Suppression: freshness degraded/stale
  if (metrics.freshnessState === 'degraded' || metrics.freshnessState === 'stale') {
    return {
      ...base,
      compositeTier: 'Insufficient Data',
      compositeColor: 'gray',
      compositeAction: 'None',
      drivingMetric: 'freshness',
      metrics: [],
      suppressed: true,
      suppressionReason: `Data freshness is ${metrics.freshnessState} — cross-source tiers suppressed`,
    };
  }

  // Suppression: insufficient sample size
  if (metrics.visits < config.minSampleSize) {
    return {
      ...base,
      compositeTier: 'Insufficient Data',
      compositeColor: 'gray',
      compositeAction: 'None',
      drivingMetric: 'sample_size',
      metrics: [],
      suppressed: true,
      suppressionReason: `Only ${metrics.visits} visits (minimum ${config.minSampleSize} required)`,
    };
  }

  // Classify each metric (skip nulls)
  const metricResults: MetricTierResult[] = [];

  if (metrics.chat_rate !== null) {
    metricResults.push(classifyChatRate(metrics.chat_rate));
  }

  if (metrics.cost_per_chat !== null) {
    metricResults.push(classifyCostPerChat(metrics.cost_per_chat));
  }

  if (metrics.reveal_rate !== null) {
    metricResults.push(classifyRevealRate(metrics.reveal_rate));
  }

  // If no metrics could be classified, suppress
  if (metricResults.length === 0) {
    return {
      ...base,
      compositeTier: 'Insufficient Data',
      compositeColor: 'gray',
      compositeAction: 'None',
      drivingMetric: 'no_metrics',
      metrics: [],
      suppressed: true,
      suppressionReason: 'All metrics are null — cannot classify',
    };
  }

  // Composite tier = worst rating across all metrics
  let worstResult = metricResults[0];
  for (const result of metricResults.slice(1)) {
    if (TIER_PRIORITY[result.label] > TIER_PRIORITY[worstResult.label]) {
      worstResult = result;
    }
  }

  return {
    ...base,
    compositeTier: worstResult.label,
    compositeColor: worstResult.color,
    compositeAction: worstResult.action,
    drivingMetric: worstResult.metric,
    metrics: metricResults,
    suppressed: false,
    suppressionReason: null,
  };
}

// ---------------------------------------------------------------------------
// Persistence interface for full tier classification run
// ---------------------------------------------------------------------------

export interface TierPersistence {
  /** Fetch active entities with their aggregated metrics */
  fetchActiveEntities(): Promise<EntityMetrics[]>;
  /** Upsert tier classification results as threshold alerts */
  upsertTierAlerts(results: TierResult[]): Promise<number>;
}

/**
 * Run tier classification after a successful combined sync.
 * Classifies all active entities and stores results in intelligence_alerts.
 */
export async function runTierClassification(
  persistence: TierPersistence,
  config: TierClassifierConfig = DEFAULT_TIER_CONFIG,
): Promise<{ classified: number; suppressed: number; alerts: TierResult[] }> {
  const entities = await persistence.fetchActiveEntities();

  const results: TierResult[] = [];
  let suppressedCount = 0;

  for (const entity of entities) {
    const result = classifyEntity(entity, config);
    results.push(result);
    if (result.suppressed) {
      suppressedCount++;
    }
  }

  // Upsert all results (including suppressed ones for transparency)
  await persistence.upsertTierAlerts(results);

  return {
    classified: results.length,
    suppressed: suppressedCount,
    alerts: results,
  };
}
