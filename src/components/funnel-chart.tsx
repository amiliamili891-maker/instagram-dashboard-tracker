/**
 * Funnel Chart — Server component showing the conversion funnel.
 * Visit → Chat → Reveal → Click
 * With drop-off percentages between each step.
 */

export interface FunnelStep {
  label: string;
  value: number | null;
}

export interface FunnelChartProps {
  steps: FunnelStep[];
}

function formatNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
}

function dropOffPct(from: number, to: number): string {
  if (from === 0) return "0%";
  return `${((to / from) * 100).toFixed(1)}%`;
}

export function FunnelChart({ steps }: FunnelChartProps) {
  // Filter out steps with null values
  const activeSteps = steps.filter((s) => s.value !== null) as { label: string; value: number }[];

  if (activeSteps.length === 0) {
    return (
      <div className="funnel-chart funnel-chart-empty">
        <p>No funnel data available for this period.</p>
      </div>
    );
  }

  const maxValue = Math.max(...activeSteps.map((s) => s.value), 1);

  return (
    <div className="funnel-chart" role="figure" aria-label="Conversion funnel">
      {activeSteps.map((step, i) => {
        const widthPct = Math.max((step.value / maxValue) * 100, 4); // min 4% so tiny bars are visible
        const prevStep = i > 0 ? activeSteps[i - 1] : null;

        return (
          <div key={step.label} className="funnel-row">
            <span className="funnel-label">{step.label}</span>
            <div className="funnel-bar-track">
              <div
                className="funnel-bar-fill"
                style={{ width: `${widthPct}%` }}
                data-testid={`funnel-bar-${step.label.toLowerCase()}`}
              >
                <span className="funnel-bar-value">{formatNumber(step.value)}</span>
              </div>
            </div>
            {prevStep && (
              <span className="funnel-dropoff" data-testid={`funnel-dropoff-${step.label.toLowerCase()}`}>
                {dropOffPct(prevStep.value, step.value)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
