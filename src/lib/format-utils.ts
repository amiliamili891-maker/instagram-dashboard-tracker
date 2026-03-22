/**
 * Shared formatting utilities.
 * Used across server components, client components, and API routes.
 */

// --- Metric-keyed formatter (for trends/charts) ---

const PERCENT_METRICS = ['chat_rate', 'reveal_rate', 'reveal_click_through_rate', 'ctr'];
const CURRENCY_METRICS = [
  'spend', 'cpc', 'cpm', 'cost_per_chat', 'cost_per_reveal',
  'cost_per_unique_click', 'cost_per_action',
];

export function formatMetricValue(value: number | null, metric: string): string {
  if (value === null) return '-';
  if (PERCENT_METRICS.includes(metric)) {
    return `${(value * 100).toFixed(2)}%`;
  }
  if (CURRENCY_METRICS.includes(metric)) {
    return `$${value.toFixed(2)}`;
  }
  if (Number.isInteger(value)) return value.toLocaleString();
  return value.toFixed(2);
}

// --- Type-keyed formatter (for tables/drill-downs) ---

export function fmt(value: number | null | undefined, type: "currency" | "percent" | "number"): string {
  if (value === null || value === undefined) return "\u2013";
  if (type === "currency") return `$${value.toFixed(2)}`;
  if (type === "percent") return `${(value * 100).toFixed(1)}%`;
  return value.toLocaleString();
}

// --- Timestamp formatting ---

export function formatTimestamp(
  iso: string | null | undefined,
  opts?: { fallback?: string; includeSeconds?: boolean; includeYear?: boolean },
): string {
  const fallback = opts?.fallback ?? "-";
  if (!iso) return fallback;
  try {
    const options: Intl.DateTimeFormatOptions = {
      timeZone: "America/Los_Angeles",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    };
    if (opts?.includeYear) options.year = "numeric";
    if (opts?.includeSeconds) options.second = "2-digit";
    return new Date(iso).toLocaleString("en-US", options);
  } catch {
    return iso;
  }
}

// --- Safe division ---

export function safeDivide(numerator: number | null | undefined, denominator: number | null | undefined): number | null {
  if (numerator == null || denominator == null || denominator === 0) return null;
  return numerator / denominator;
}
