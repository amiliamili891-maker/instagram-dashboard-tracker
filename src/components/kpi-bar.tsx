"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

interface KpiItem {
  metric: string;
  label: string;
  current: number | null;
  comparison: number | null;
  delta_pct: number | null;
  format: string;
  invert?: boolean;
}

function formatValue(value: number | null, format: string): string {
  if (value === null) return "\u2013";
  if (format === "currency") return `$${value.toFixed(2)}`;
  if (format === "percent") return `${(value * 100).toFixed(1)}%`;
  return value.toFixed(2);
}

function DeltaArrow({
  delta,
  invert,
}: {
  delta: number | null;
  invert?: boolean;
}) {
  if (delta === null) return <span className="delta-none">{"\u2013"}</span>;
  const isPositive = delta > 0;
  // For inverted metrics (cost), positive delta is bad
  const isGood = invert ? !isPositive : isPositive;
  const arrow = isPositive ? "\u25B2" : "\u25BC";
  const cls = isGood ? "delta-good" : "delta-bad";
  return (
    <span className={`delta ${cls}`}>
      {arrow} {Math.abs(delta).toFixed(1)}%
    </span>
  );
}

export function KpiBar() {
  const searchParams = useSearchParams();
  const period = searchParams.get("period") || "7d";
  const [kpis, setKpis] = useState<KpiItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/stats/overview?period=${period}`)
      .then((r) => r.json())
      .then((data) => {
        setKpis(data.kpis ?? []);
        setLoading(false);
      })
      .catch(() => {
        setKpis([]);
        setLoading(false);
      });
  }, [period]);

  if (loading) {
    return (
      <div className="kpi-bar kpi-bar-loading">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="kpi-card kpi-card-skeleton">
            <div className="skeleton-line skeleton-label" />
            <div className="skeleton-line skeleton-value" />
          </div>
        ))}
      </div>
    );
  }

  if (kpis.length === 0) {
    return (
      <div className="kpi-bar kpi-bar-empty">
        <p>No KPI data available for this period.</p>
      </div>
    );
  }

  return (
    <div className="kpi-bar">
      {kpis.map((kpi) => (
        <div key={kpi.metric} className="kpi-card">
          <span className="kpi-label">{kpi.label}</span>
          <span className="kpi-value">
            {formatValue(kpi.current, kpi.format)}
          </span>
          <DeltaArrow delta={kpi.delta_pct} invert={kpi.invert} />
        </div>
      ))}
    </div>
  );
}
