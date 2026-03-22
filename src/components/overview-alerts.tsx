"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

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

export function OverviewAlerts() {
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/intelligence/alerts?limit=5")
      .then((r) => {
        if (!r.ok) throw new Error("Failed");
        return r.json();
      })
      .then((json) => {
        setAlerts(json.data ?? []);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="overview-alerts">
        <h2 className="section-title">Intelligence Alerts</h2>
        <div className="overview-alerts-loading">Loading alerts...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="overview-alerts">
        <h2 className="section-title">Intelligence Alerts</h2>
        <div className="overview-alerts-empty">
          Unable to load alerts.
        </div>
      </div>
    );
  }

  if (alerts.length === 0) {
    return (
      <div className="overview-alerts">
        <h2 className="section-title">Intelligence Alerts</h2>
        <div className="overview-alerts-empty">
          No recent alerts — all systems nominal.
        </div>
      </div>
    );
  }

  return (
    <div className="overview-alerts">
      <div className="overview-alerts-header">
        <h2 className="section-title" style={{ margin: 0 }}>
          Intelligence Alerts
        </h2>
        <Link href="/dashboard/intelligence" className="overview-alerts-link">
          View all
        </Link>
      </div>
      <div className="overview-alerts-list">
        {alerts.map((alert) => (
          <div
            key={alert.id}
            className={`overview-alert-row overview-alert-${alert.severity}`}
          >
            <span
              className={`severity-badge badge-${alert.severity === "critical" ? "critical" : alert.severity === "warning" ? "warning" : "info"}`}
            >
              {alert.severity}
            </span>
            <span className="overview-alert-message">{alert.message}</span>
            <span className="overview-alert-entity">
              {alert.entity_type} {alert.entity_id.slice(0, 8)}...
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
