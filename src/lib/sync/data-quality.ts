/**
 * Data Quality Checks
 *
 * Tracks unmatched join rate, duplicate rate, and null-key rate.
 * Uses thresholds from DATA_QUALITY_THRESHOLDS in data-contract.ts.
 * Logs issues to intelligence_alerts table.
 */

import { DATA_QUALITY_THRESHOLDS } from '@/lib/contracts/data-contract';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QualitySeverity = 'healthy' | 'warning' | 'critical';

export interface QualityCheckResult {
  check: string;
  value: number;
  threshold: { warning: number; critical: number };
  severity: QualitySeverity;
  message: string;
}

export interface DataQualityResult {
  checks: QualityCheckResult[];
  overallSeverity: QualitySeverity;
  alerts: DataQualityAlert[];
}

export interface DataQualityAlert {
  entityType: string;
  entityId: string;
  severity: 'warning' | 'critical';
  message: string;
  data: Record<string, unknown>;
}

/** Input data for quality checks */
export interface QualityInput {
  totalGhstlyRows: number;
  unjoinableGhstlyRows: number;
  /** Number of duplicate natural key occurrences across both sources */
  duplicateRows: number;
  totalRows: number;
  /** Number of Meta-sourced rows with null campaign_id/adset_id/ad_id */
  nullKeyMetaRows: number;
  totalMetaRows: number;
}

export interface DataQualityPersistence {
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
// Severity Classification
// ---------------------------------------------------------------------------

function classifySeverity(
  value: number,
  warningThreshold: number,
  criticalThreshold: number,
): QualitySeverity {
  if (value > criticalThreshold) return 'critical';
  if (value > warningThreshold) return 'warning';
  return 'healthy';
}

// ---------------------------------------------------------------------------
// Quality Check Runner
// ---------------------------------------------------------------------------

/**
 * Run all data quality checks against the provided input.
 */
export function evaluateDataQuality(input: QualityInput): QualityCheckResult[] {
  const checks: QualityCheckResult[] = [];

  // 1. Unmatched join rate
  const unmatchedRate = input.totalGhstlyRows > 0
    ? (input.unjoinableGhstlyRows / input.totalGhstlyRows) * 100
    : 0;

  checks.push({
    check: 'unmatched_join_rate',
    value: unmatchedRate,
    threshold: {
      warning: DATA_QUALITY_THRESHOLDS.unmatchedJoinRateWarning,
      critical: DATA_QUALITY_THRESHOLDS.unmatchedJoinRateCritical,
    },
    severity: classifySeverity(
      unmatchedRate,
      DATA_QUALITY_THRESHOLDS.unmatchedJoinRateWarning,
      DATA_QUALITY_THRESHOLDS.unmatchedJoinRateCritical,
    ),
    message: `Unmatched join rate: ${unmatchedRate.toFixed(1)}% (${input.unjoinableGhstlyRows}/${input.totalGhstlyRows} rows)`,
  });

  // 2. Duplicate rate
  const duplicateRate = input.totalRows > 0
    ? (input.duplicateRows / input.totalRows) * 100
    : 0;

  checks.push({
    check: 'duplicate_rate',
    value: duplicateRate,
    threshold: {
      warning: DATA_QUALITY_THRESHOLDS.duplicateRateWarning,
      critical: DATA_QUALITY_THRESHOLDS.duplicateRateCritical,
    },
    severity: classifySeverity(
      duplicateRate,
      DATA_QUALITY_THRESHOLDS.duplicateRateWarning,
      DATA_QUALITY_THRESHOLDS.duplicateRateCritical,
    ),
    message: `Duplicate rate: ${duplicateRate.toFixed(1)}% (${input.duplicateRows}/${input.totalRows} rows)`,
  });

  // 3. Null-key rate (Meta rows)
  const nullKeyRate = input.totalMetaRows > 0
    ? (input.nullKeyMetaRows / input.totalMetaRows) * 100
    : 0;

  checks.push({
    check: 'null_key_rate',
    value: nullKeyRate,
    threshold: {
      warning: DATA_QUALITY_THRESHOLDS.nullKeyRateWarning,
      critical: DATA_QUALITY_THRESHOLDS.nullKeyRateCritical,
    },
    severity: classifySeverity(
      nullKeyRate,
      DATA_QUALITY_THRESHOLDS.nullKeyRateWarning,
      DATA_QUALITY_THRESHOLDS.nullKeyRateCritical,
    ),
    message: `Null-key rate (Meta): ${nullKeyRate.toFixed(1)}% (${input.nullKeyMetaRows}/${input.totalMetaRows} rows)`,
  });

  return checks;
}

/**
 * Run data quality checks and log alerts for any issues.
 */
export async function runDataQualityChecks(
  input: QualityInput,
  persistence: DataQualityPersistence,
  syncBatchId: string,
): Promise<DataQualityResult> {
  const checks = evaluateDataQuality(input);

  // Determine overall severity
  const severityPriority: Record<QualitySeverity, number> = {
    healthy: 0,
    warning: 1,
    critical: 2,
  };
  const overallSeverity = checks.reduce<QualitySeverity>((worst, c) => {
    return severityPriority[c.severity] > severityPriority[worst] ? c.severity : worst;
  }, 'healthy');

  // Generate alerts for non-healthy checks
  const alerts: DataQualityAlert[] = [];
  for (const check of checks) {
    if (check.severity !== 'healthy') {
      const alert: DataQualityAlert = {
        entityType: 'system',
        entityId: 'data_quality',
        severity: check.severity === 'critical' ? 'critical' : 'warning',
        message: check.message,
        data: {
          check: check.check,
          value: check.value,
          threshold: check.threshold,
        },
      };
      alerts.push(alert);

      await persistence.insertAlert({
        entity_type: 'system' as string,
        entity_id: 'data_quality',
        alert_type: 'data_quality',
        severity: alert.severity,
        message: alert.message,
        data: alert.data,
        sync_batch_id: syncBatchId,
      });
    }
  }

  return { checks, overallSeverity, alerts };
}
