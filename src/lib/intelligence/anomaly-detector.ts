/**
 * Anomaly Detector
 *
 * Compares the last 3 days vs prior 3 days for each entity.
 * Flags changes above configured thresholds with human-readable alerts
 * including concrete values and direction of change.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AnomalyThresholds {
  /** Minimum % change to flag cost_per_chat (default 30%) */
  costPerChatChangePercent: number;
  /** Minimum % change to flag chat_rate (default 20%) */
  chatRateChangePercent: number;
  /** Minimum % change to flag reveal_rate (default 25%) */
  revealRateChangePercent: number;
  /** Minimum % change to flag spend (default 50%) */
  spendChangePercent: number;
}

export const DEFAULT_ANOMALY_THRESHOLDS: AnomalyThresholds = {
  costPerChatChangePercent: 30,
  chatRateChangePercent: 20,
  revealRateChangePercent: 25,
  spendChangePercent: 50,
};

export type AnomalyDirection = 'increase' | 'decrease';
export type AnomalySeverity = 'warning' | 'critical';

export interface Anomaly {
  entityId: string;
  entityLevel: 'campaign' | 'adset' | 'ad';
  metric: string;
  metricLabel: string;
  recentValue: number;
  priorValue: number;
  changePercent: number;
  direction: AnomalyDirection;
  severity: AnomalySeverity;
  message: string;
}

export interface AnomalyResult {
  anomalies: Anomaly[];
  entitiesChecked: number;
  entitiesFlagged: number;
}

/** Aggregated entity metrics for a time window */
export interface EntityWindowMetrics {
  entityId: string;
  entityLevel: 'campaign' | 'adset' | 'ad';
  spend: number | null;
  chats: number | null;
  visits: number | null;
  reveals: number | null;
  chat_rate: number | null;
  cost_per_chat: number | null;
  reveal_rate: number | null;
}

export interface DateRange {
  from: string;
  to: string;
}

export interface AnomalyPersistence {
  /** Fetch aggregated metrics for entities in a date range */
  fetchEntityMetrics(dateRange: DateRange): Promise<EntityWindowMetrics[]>;
}

// ---------------------------------------------------------------------------
// Metric labels for human-readable messages
// ---------------------------------------------------------------------------

const METRIC_LABELS: Record<string, string> = {
  cost_per_chat: 'Cost per Chat',
  chat_rate: 'Chat Rate',
  reveal_rate: 'Reveal Rate',
  spend: 'Spend',
};

// ---------------------------------------------------------------------------
// Core Detection
// ---------------------------------------------------------------------------

/**
 * Format a metric value for human display.
 */
function formatValue(metric: string, value: number): string {
  if (metric === 'cost_per_chat' || metric === 'spend') {
    return `$${value.toFixed(2)}`;
  }
  if (metric === 'chat_rate' || metric === 'reveal_rate') {
    return `${(value * 100).toFixed(1)}%`;
  }
  return value.toFixed(2);
}

/**
 * Compare two windows of metrics for a single entity and detect anomalies.
 */
export function detectEntityAnomalies(
  recent: EntityWindowMetrics,
  prior: EntityWindowMetrics,
  thresholds: AnomalyThresholds = DEFAULT_ANOMALY_THRESHOLDS,
): Anomaly[] {
  const anomalies: Anomaly[] = [];

  const checks: {
    metric: string;
    recentVal: number | null;
    priorVal: number | null;
    threshold: number;
    /** For cost metrics, increase is bad. For rate metrics, decrease is bad. */
    badDirection: AnomalyDirection;
  }[] = [
    {
      metric: 'cost_per_chat',
      recentVal: recent.cost_per_chat,
      priorVal: prior.cost_per_chat,
      threshold: thresholds.costPerChatChangePercent,
      badDirection: 'increase',
    },
    {
      metric: 'chat_rate',
      recentVal: recent.chat_rate,
      priorVal: prior.chat_rate,
      threshold: thresholds.chatRateChangePercent,
      badDirection: 'decrease',
    },
    {
      metric: 'reveal_rate',
      recentVal: recent.reveal_rate,
      priorVal: prior.reveal_rate,
      threshold: thresholds.revealRateChangePercent,
      badDirection: 'decrease',
    },
    {
      metric: 'spend',
      recentVal: recent.spend,
      priorVal: prior.spend,
      threshold: thresholds.spendChangePercent,
      badDirection: 'increase',
    },
  ];

  for (const check of checks) {
    if (check.recentVal === null || check.priorVal === null || check.priorVal === 0) {
      continue;
    }

    const changePercent =
      ((check.recentVal - check.priorVal) / Math.abs(check.priorVal)) * 100;
    const absChange = Math.abs(changePercent);

    if (absChange < check.threshold) {
      continue;
    }

    const direction: AnomalyDirection = changePercent > 0 ? 'increase' : 'decrease';
    const severity: AnomalySeverity =
      direction === check.badDirection && absChange >= check.threshold * 2
        ? 'critical'
        : 'warning';

    const metricLabel = METRIC_LABELS[check.metric] ?? check.metric;
    const directionWord = direction === 'increase' ? 'increased' : 'dropped';
    const message =
      `${recent.entityLevel} ${recent.entityId}: ${metricLabel} ${directionWord} ` +
      `from ${formatValue(check.metric, check.priorVal)} to ${formatValue(check.metric, check.recentVal)} ` +
      `(${changePercent > 0 ? '+' : ''}${changePercent.toFixed(1)}%) over the last 3 days`;

    anomalies.push({
      entityId: recent.entityId,
      entityLevel: recent.entityLevel,
      metric: check.metric,
      metricLabel,
      recentValue: check.recentVal,
      priorValue: check.priorVal,
      changePercent,
      direction,
      severity,
      message,
    });
  }

  return anomalies;
}

// ---------------------------------------------------------------------------
// Date Helpers
// ---------------------------------------------------------------------------

/**
 * Compute 3-day windows relative to a reference date.
 * Recent = refDate-2 to refDate, Prior = refDate-5 to refDate-3
 */
export function computeWindows(referenceDate: string): {
  recent: DateRange;
  prior: DateRange;
} {
  // Use UTC explicitly to avoid timezone-related date shifts
  const ref = new Date(referenceDate + 'T12:00:00Z');

  const recentTo = new Date(ref);
  const recentFrom = new Date(ref);
  recentFrom.setUTCDate(recentFrom.getUTCDate() - 2);

  const priorTo = new Date(ref);
  priorTo.setUTCDate(priorTo.getUTCDate() - 3);
  const priorFrom = new Date(ref);
  priorFrom.setUTCDate(priorFrom.getUTCDate() - 5);

  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  return {
    recent: { from: fmt(recentFrom), to: fmt(recentTo) },
    prior: { from: fmt(priorFrom), to: fmt(priorTo) },
  };
}

// ---------------------------------------------------------------------------
// Main Detection
// ---------------------------------------------------------------------------

/**
 * Detect anomalies by comparing last 3 days vs prior 3 days for all entities.
 */
export async function detectAnomalies(
  persistence: AnomalyPersistence,
  dateRange: { referenceDate: string },
  thresholds: AnomalyThresholds = DEFAULT_ANOMALY_THRESHOLDS,
): Promise<AnomalyResult> {
  const { recent, prior } = computeWindows(dateRange.referenceDate);

  const [recentMetrics, priorMetrics] = await Promise.all([
    persistence.fetchEntityMetrics(recent),
    persistence.fetchEntityMetrics(prior),
  ]);

  // Index prior metrics by entity key
  const priorIndex = new Map<string, EntityWindowMetrics>();
  for (const m of priorMetrics) {
    priorIndex.set(`${m.entityId}:${m.entityLevel}`, m);
  }

  const allAnomalies: Anomaly[] = [];
  const flaggedEntities = new Set<string>();

  for (const recentEntity of recentMetrics) {
    const key = `${recentEntity.entityId}:${recentEntity.entityLevel}`;
    const priorEntity = priorIndex.get(key);
    if (!priorEntity) continue;

    const entityAnomalies = detectEntityAnomalies(recentEntity, priorEntity, thresholds);
    if (entityAnomalies.length > 0) {
      flaggedEntities.add(key);
      allAnomalies.push(...entityAnomalies);
    }
  }

  return {
    anomalies: allAnomalies,
    entitiesChecked: recentMetrics.length,
    entitiesFlagged: flaggedEntities.size,
  };
}
