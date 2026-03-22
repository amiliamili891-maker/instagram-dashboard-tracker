/**
 * Reconciliation Engine
 *
 * Compares daily_ghstly_stats vs sessions for reconcilable metrics:
 *   chats, reveals, click_throughs, conversions
 *
 * Uses thresholds from RECONCILIATION_CONFIG in data-contract.ts:
 *   Healthy: <= 5% relative OR <= 10 absolute
 *   Warning: > 5% and <= 10%, OR > 10 absolute
 *   Breach:  > 10% OR > 25 absolute after replay
 *
 * On breach: logs data-quality alert to intelligence_alerts,
 * suppresses cross-source recommendations.
 */

import { RECONCILIATION_CONFIG } from '@/lib/contracts/data-contract';
import { type DateRange } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DriftLevel = 'healthy' | 'warning' | 'breach';

export interface DriftResult {
  metric: string;
  statsValue: number;
  sessionValue: number;
  absoluteDrift: number;
  relativeDriftPercent: number | null;
  level: DriftLevel;
}

export interface ReconciliationRow {
  reportDate: string;
  entityLevel: string;
  entityId: string;
  drifts: DriftResult[];
  overallLevel: DriftLevel;
}

export interface ReconciliationResult {
  rows: ReconciliationRow[];
  totalChecked: number;
  healthyCount: number;
  warningCount: number;
  breachCount: number;
  breachRatePercent: number;
  shouldSuppressRecommendations: boolean;
  alerts: ReconciliationAlert[];
}

export interface ReconciliationAlert {
  entityType: string;
  entityId: string;
  severity: 'warning' | 'critical';
  message: string;
  data: Record<string, unknown>;
}

/** Stats row from daily_ghstly_stats for reconciliation */
export interface StatsForReconciliation {
  report_date: string;
  entity_level: string;
  entity_id: string;
  chats: number;
  reveals: number;
  click_throughs: number;
  ghstly_conversions: number;
}

/** Aggregated session data for reconciliation (grouped by ad/day) */
export interface SessionAggregateForReconciliation {
  report_date: string;
  entity_level: string;
  entity_id: string;
  chats: number;
  reveals: number;
  click_throughs: number;
  conversions: number;
}

// DateRange imported from ./types
export type { DateRange } from './types';

/** Persistence interface for dependency injection */
export interface ReconciliationPersistence {
  fetchGhstlyStatsForReconciliation(dateRange: DateRange): Promise<StatsForReconciliation[]>;
  fetchSessionAggregates(dateRange: DateRange): Promise<SessionAggregateForReconciliation[]>;
  insertAlert(alert: {
    entity_type: string;
    entity_id: string;
    alert_type: string;
    severity: string;
    message: string;
    data: Record<string, unknown>;
    sync_batch_id: string;
  }): Promise<void>;
}

// ---------------------------------------------------------------------------
// Drift Classification
// ---------------------------------------------------------------------------

/**
 * Classify drift level for a single metric comparison.
 */
export function classifyDrift(
  statsValue: number,
  sessionValue: number,
): { absoluteDrift: number; relativeDriftPercent: number | null; level: DriftLevel } {
  const absoluteDrift = Math.abs(statsValue - sessionValue);

  // Calculate relative drift (use the larger value as base to avoid division by zero)
  const base = Math.max(statsValue, sessionValue);
  const relativeDriftPercent = base > 0 ? (absoluteDrift / base) * 100 : null;

  const { thresholds } = RECONCILIATION_CONFIG;

  // Check healthy first
  if (
    (relativeDriftPercent !== null && relativeDriftPercent <= thresholds.healthy.relativePercent) ||
    absoluteDrift <= thresholds.healthy.absoluteEvents
  ) {
    return { absoluteDrift, relativeDriftPercent, level: 'healthy' };
  }

  // Check breach
  if (
    (relativeDriftPercent !== null && relativeDriftPercent > thresholds.breach.relativePercent) ||
    absoluteDrift > thresholds.breach.absoluteEvents
  ) {
    return { absoluteDrift, relativeDriftPercent, level: 'breach' };
  }

  // Otherwise warning
  return { absoluteDrift, relativeDriftPercent, level: 'warning' };
}

/**
 * Compare a stats row vs session aggregate for all reconcilable metrics.
 */
export function reconcileRow(
  stats: StatsForReconciliation,
  sessionAgg: SessionAggregateForReconciliation,
): ReconciliationRow {
  const metricPairs: { metric: string; statsVal: number; sessionVal: number }[] = [
    { metric: 'chats', statsVal: stats.chats, sessionVal: sessionAgg.chats },
    { metric: 'reveals', statsVal: stats.reveals, sessionVal: sessionAgg.reveals },
    { metric: 'click_throughs', statsVal: stats.click_throughs, sessionVal: sessionAgg.click_throughs },
    { metric: 'conversions', statsVal: stats.ghstly_conversions, sessionVal: sessionAgg.conversions },
  ];

  const drifts: DriftResult[] = metricPairs.map(({ metric, statsVal, sessionVal }) => {
    const { absoluteDrift, relativeDriftPercent, level } = classifyDrift(statsVal, sessionVal);
    return {
      metric,
      statsValue: statsVal,
      sessionValue: sessionVal,
      absoluteDrift,
      relativeDriftPercent,
      level,
    };
  });

  // Overall level is the worst across all metrics
  const levelPriority: Record<DriftLevel, number> = {
    healthy: 0,
    warning: 1,
    breach: 2,
  };
  const overallLevel = drifts.reduce<DriftLevel>((worst, d) => {
    return levelPriority[d.level] > levelPriority[worst] ? d.level : worst;
  }, 'healthy');

  return {
    reportDate: stats.report_date,
    entityLevel: stats.entity_level,
    entityId: stats.entity_id,
    drifts,
    overallLevel,
  };
}

// ---------------------------------------------------------------------------
// Main Reconciliation
// ---------------------------------------------------------------------------

/**
 * Run reconciliation for a given date range.
 *
 * Compares daily_ghstly_stats vs aggregated session data for
 * chats, reveals, click_throughs, and conversions.
 */
export async function runReconciliation(
  persistence: ReconciliationPersistence,
  dateRange: DateRange,
  syncBatchId: string = crypto.randomUUID(),
): Promise<ReconciliationResult> {
  // 1. Fetch source data
  const [statsRows, sessionAggs] = await Promise.all([
    persistence.fetchGhstlyStatsForReconciliation(dateRange),
    persistence.fetchSessionAggregates(dateRange),
  ]);

  // 2. Index session aggregates by key
  const sessionIndex = new Map<string, SessionAggregateForReconciliation>();
  for (const agg of sessionAggs) {
    const key = `${agg.entity_id}:${agg.report_date}:${agg.entity_level}`;
    sessionIndex.set(key, agg);
  }

  // 3. Reconcile each stats row that has a matching session aggregate
  const rows: ReconciliationRow[] = [];
  for (const stats of statsRows) {
    const key = `${stats.entity_id}:${stats.report_date}:${stats.entity_level}`;
    const sessionAgg = sessionIndex.get(key);
    if (!sessionAgg) continue;

    rows.push(reconcileRow(stats, sessionAgg));
  }

  // 4. Count levels
  const totalChecked = rows.length;
  const healthyCount = rows.filter((r) => r.overallLevel === 'healthy').length;
  const warningCount = rows.filter((r) => r.overallLevel === 'warning').length;
  const breachCount = rows.filter((r) => r.overallLevel === 'breach').length;
  const breachRatePercent = totalChecked > 0 ? (breachCount / totalChecked) * 100 : 0;

  // 5. Determine suppression
  const shouldSuppressRecommendations =
    breachRatePercent > RECONCILIATION_CONFIG.breachPolicy.suppressionThresholdPercent;

  // 6. Generate alerts for warning and breach rows
  const alerts: ReconciliationAlert[] = [];
  for (const row of rows) {
    if (row.overallLevel === 'warning' || row.overallLevel === 'breach') {
      const severity: 'warning' | 'critical' = row.overallLevel === 'breach' ? 'critical' : 'warning';
      const breachMetrics = row.drifts
        .filter((d) => d.level !== 'healthy')
        .map((d) => `${d.metric}: stats=${d.statsValue} sessions=${d.sessionValue} (${d.relativeDriftPercent?.toFixed(1) ?? 'N/A'}%)`)
        .join('; ');

      const alert: ReconciliationAlert = {
        entityType: row.entityLevel,
        entityId: row.entityId,
        severity,
        message: `Reconciliation ${row.overallLevel} for ${row.entityLevel} ${row.entityId} on ${row.reportDate}: ${breachMetrics}`,
        data: {
          reportDate: row.reportDate,
          drifts: row.drifts,
          overallLevel: row.overallLevel,
        },
      };
      alerts.push(alert);

      // Persist alert
      await persistence.insertAlert({
        entity_type: row.entityLevel,
        entity_id: row.entityId,
        alert_type: 'data_quality',
        severity,
        message: alert.message,
        data: alert.data,
        sync_batch_id: syncBatchId,
      });
    }
  }

  return {
    rows,
    totalChecked,
    healthyCount,
    warningCount,
    breachCount,
    breachRatePercent,
    shouldSuppressRecommendations,
    alerts,
  };
}
