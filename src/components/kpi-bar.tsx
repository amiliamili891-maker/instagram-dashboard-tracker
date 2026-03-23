/**
 * KPI Bar — Server component that renders KPI cards.
 * Data is fetched by the page and passed as props.
 */

/**
 * KpiBarSkeleton — Suspense fallback for the KPI bar.
 * Renders 5 placeholder cards matching the KPI bar layout.
 */
export function KpiBarSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="kpi-bar" role="status" aria-label="Loading KPI data">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="kpi-card kpi-card-skeleton">
          <div className="skeleton-cell" style={{ width: '60%', height: 12 }} />
          <div className="skeleton-cell" style={{ width: '40%', height: 24 }} />
          <div className="skeleton-cell" style={{ width: '30%', height: 12 }} />
        </div>
      ))}
    </div>
  );
}

export interface KpiItem {
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
  if (format === "number") return Math.round(value).toLocaleString();
  if (format === "multiplier") return `${value.toFixed(2)}x`;
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

export function KpiBar({ kpis }: { kpis: KpiItem[] }) {
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
