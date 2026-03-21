/**
 * Shared metric value formatting.
 * Used by both server (trends page) and client (TrendChart) components.
 */

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
