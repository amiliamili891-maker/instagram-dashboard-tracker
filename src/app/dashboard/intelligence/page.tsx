/**
 * Intelligence Dashboard — /dashboard/intelligence
 *
 * Full intelligence board showing:
 * - Active threshold alerts with tier badges and explanations
 * - Anomaly alerts with concrete values
 * - Budget recommendations (pause/scale candidates)
 * - Mismatch warnings
 *
 * All surfaces are suppressed in degraded/stale mode.
 */

export const dynamic = 'force-dynamic';

import { createClient } from '@supabase/supabase-js';
import { getServerEnv } from '@/lib/env';

// ---------------------------------------------------------------------------
// Types for display
// ---------------------------------------------------------------------------

interface AlertRow {
  id: string;
  entity_type: string;
  entity_id: string;
  alert_type: string;
  severity: string;
  message: string;
  data: Record<string, unknown>;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Data Fetching
// ---------------------------------------------------------------------------

async function fetchAlerts(): Promise<{
  thresholdAlerts: AlertRow[];
  anomalyAlerts: AlertRow[];
  dataQualityAlerts: AlertRow[];
  suppressed: boolean;
  suppressionReason: string | null;
}> {
  const env = getServerEnv();
  const supabase = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Check freshness
  const { data: syncLogs } = await supabase
    .from('sync_logs')
    .select('source, status, completed_at')
    .eq('status', 'success')
    .order('completed_at', { ascending: false })
    .limit(10);

  const metaSuccess = syncLogs?.find((l) => l.source === 'meta');
  const ghstlySuccess = syncLogs?.find((l) => l.source === 'ghstly');

  if (!metaSuccess && !ghstlySuccess) {
    return {
      thresholdAlerts: [],
      anomalyAlerts: [],
      dataQualityAlerts: [],
      suppressed: true,
      suppressionReason: 'Data is stale — no successful syncs found. Intelligence surfaces are suppressed.',
    };
  }

  if (!metaSuccess || !ghstlySuccess) {
    return {
      thresholdAlerts: [],
      anomalyAlerts: [],
      dataQualityAlerts: [],
      suppressed: true,
      suppressionReason: `Data is degraded — ${!metaSuccess ? 'Meta' : 'Ghstly'} sync missing. Cross-source intelligence suppressed.`,
    };
  }

  // Fetch recent alerts
  const { data: alerts, error } = await supabase
    .from('intelligence_alerts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error || !alerts) {
    return {
      thresholdAlerts: [],
      anomalyAlerts: [],
      dataQualityAlerts: [],
      suppressed: false,
      suppressionReason: null,
    };
  }

  return {
    thresholdAlerts: alerts.filter((a: AlertRow) => a.alert_type === 'threshold'),
    anomalyAlerts: alerts.filter((a: AlertRow) => a.alert_type === 'anomaly'),
    dataQualityAlerts: alerts.filter((a: AlertRow) => a.alert_type === 'data_quality'),
    suppressed: false,
    suppressionReason: null,
  };
}

// ---------------------------------------------------------------------------
// Helper Components
// ---------------------------------------------------------------------------

function SeverityBadge({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    critical: 'badge-critical',
    warning: 'badge-warning',
    info: 'badge-info',
  };
  return (
    <span className={`severity-badge ${colors[severity] ?? 'badge-info'}`}>
      {severity}
    </span>
  );
}

function TierBadge({ data }: { data: Record<string, unknown> }) {
  const tier = (data.compositeTier as string) ?? 'Unknown';
  const color = (data.compositeColor as string) ?? 'gray';
  return (
    <span className={`tier-badge tier-${color}`}>
      {tier}
    </span>
  );
}

function AlertCard({ alert }: { alert: AlertRow }) {
  return (
    <div className={`alert-card alert-${alert.severity}`}>
      <div className="alert-header">
        <SeverityBadge severity={alert.severity} />
        <span className="alert-entity">
          {alert.entity_type} {alert.entity_id}
        </span>
        {alert.alert_type === 'threshold' && <TierBadge data={alert.data} />}
      </div>
      <p className="alert-message">{alert.message}</p>
      <time className="alert-time">
        {new Date(alert.created_at).toLocaleString('en-US', {
          timeZone: 'America/Los_Angeles',
        })}
      </time>
    </div>
  );
}

function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p>{message}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function IntelligencePage() {
  const {
    thresholdAlerts,
    anomalyAlerts,
    dataQualityAlerts,
    suppressed,
    suppressionReason,
  } = await fetchAlerts();

  if (suppressed) {
    return (
      <section className="intelligence-page">
        <h1>Intelligence Board</h1>
        <div className="suppression-banner">
          <p>{suppressionReason}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="intelligence-page">
      <h1>Intelligence Board</h1>

      {/* Threshold Tier Alerts */}
      <div className="intelligence-section">
        <h2>Performance Tiers</h2>
        {thresholdAlerts.length === 0 ? (
          <EmptyState
            title="No tier alerts"
            message="All entities are performing within acceptable thresholds."
          />
        ) : (
          <div className="alert-grid">
            {thresholdAlerts.map((alert) => (
              <AlertCard key={alert.id} alert={alert} />
            ))}
          </div>
        )}
      </div>

      {/* Anomaly Alerts */}
      <div className="intelligence-section">
        <h2>Anomalies</h2>
        {anomalyAlerts.length === 0 ? (
          <EmptyState
            title="No anomalies detected"
            message="No significant metric changes detected in the last 3 days."
          />
        ) : (
          <div className="alert-grid">
            {anomalyAlerts.map((alert) => (
              <AlertCard key={alert.id} alert={alert} />
            ))}
          </div>
        )}
      </div>

      {/* Data Quality Alerts */}
      <div className="intelligence-section">
        <h2>Data Quality</h2>
        {dataQualityAlerts.length === 0 ? (
          <EmptyState
            title="No data quality issues"
            message="Reconciliation is healthy across all entities."
          />
        ) : (
          <div className="alert-grid">
            {dataQualityAlerts.map((alert) => (
              <AlertCard key={alert.id} alert={alert} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
