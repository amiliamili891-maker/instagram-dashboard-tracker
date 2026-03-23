/**
 * Creative Health Scorer + Format Diversity Monitor
 *
 * Ad Health Score: Days running + CPA trend + spend efficiency → green/yellow/red
 * Format Diversity: Counts distinct format categories among active ads, alerts when < 3
 *
 * These are deterministic, rule-based — no LLM calls.
 */

import {
  analyzeFormatCoverage,
  type FormatCoverage,
  type FormatCategory,
  FORMAT_LABELS,
} from '@/lib/creative-attributes';

// ---------------------------------------------------------------------------
// Ad Health Score
// ---------------------------------------------------------------------------

export type HealthStatus = 'green' | 'yellow' | 'red';

export interface AdHealthScore {
  entityId: string;
  entityName: string | null;
  formatCategory: FormatCategory | null;
  /** Days since first impression (from earliest report_date) */
  daysRunning: number;
  /** Total spend in the analysis window */
  totalSpend: number;
  /** Average daily spend */
  dailySpend: number;
  /** Cost per chat (latest period) */
  costPerChat: number | null;
  /** Cost per chat trend: positive = getting worse, negative = improving */
  costPerChatTrend: number | null;
  /** Chat rate (latest period) */
  chatRate: number | null;
  /** Overall health status */
  health: HealthStatus;
  /** Human-readable reason for the health status */
  reason: string;
}

export interface AdHealthInput {
  entityId: string;
  entityName: string | null;
  formatCategory: string | null;
  /** First report_date for this ad */
  firstDate: string;
  /** Most recent report_date */
  lastDate: string;
  /** Total spend across all days */
  totalSpend: number;
  /** Number of days with data */
  daysWithData: number;
  /** Cost per chat in the recent half of the window */
  recentCostPerChat: number | null;
  /** Cost per chat in the earlier half of the window */
  priorCostPerChat: number | null;
  /** Recent chat rate */
  recentChatRate: number | null;
}

/**
 * Score a single ad's health based on age, spend trend, and performance.
 *
 * Rules:
 * - RED: Running 21+ days AND (cost_per_chat trending up >30% OR chat_rate < 40%)
 * - RED: Running 14+ days AND cost_per_chat > $0.60 (Critical tier threshold)
 * - YELLOW: Running 14+ days AND cost_per_chat trending up >15%
 * - YELLOW: Running 7+ days AND cost_per_chat > $0.40 (Poor tier threshold)
 * - YELLOW: Spend < $5 total (insufficient data)
 * - GREEN: Everything else
 */
export function scoreAdHealth(input: AdHealthInput): AdHealthScore {
  const now = new Date();
  const firstDate = new Date(input.firstDate);
  const daysRunning = Math.max(1, Math.ceil((now.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24)));

  const dailySpend = input.daysWithData > 0 ? input.totalSpend / input.daysWithData : 0;

  // Calculate CPA trend (positive = worsening)
  let costPerChatTrend: number | null = null;
  if (input.recentCostPerChat !== null && input.priorCostPerChat !== null && input.priorCostPerChat > 0) {
    costPerChatTrend = (input.recentCostPerChat - input.priorCostPerChat) / input.priorCostPerChat;
  }

  let health: HealthStatus = 'green';
  let reason = 'Healthy — performing within targets';

  // Insufficient data
  if (input.totalSpend < 5) {
    return {
      entityId: input.entityId,
      entityName: input.entityName,
      formatCategory: input.formatCategory as FormatCategory | null,
      daysRunning,
      totalSpend: input.totalSpend,
      dailySpend,
      costPerChat: input.recentCostPerChat,
      costPerChatTrend,
      chatRate: input.recentChatRate,
      health: 'yellow',
      reason: `Insufficient data — only $${input.totalSpend.toFixed(2)} spent`,
    };
  }

  // RED checks
  if (daysRunning >= 21 && costPerChatTrend !== null && costPerChatTrend > 0.30) {
    health = 'red';
    reason = `Fatigued — running ${daysRunning}d, cost/chat up ${(costPerChatTrend * 100).toFixed(0)}%. Replace now.`;
  } else if (daysRunning >= 21 && input.recentChatRate !== null && input.recentChatRate < 0.40) {
    health = 'red';
    reason = `Fatigued — running ${daysRunning}d, chat rate ${(input.recentChatRate * 100).toFixed(0)}% (below 40%). Replace now.`;
  } else if (daysRunning >= 14 && input.recentCostPerChat !== null && input.recentCostPerChat > 0.60) {
    health = 'red';
    reason = `Critical CPA — $${input.recentCostPerChat.toFixed(2)}/chat after ${daysRunning}d. Kill immediately.`;
  }
  // YELLOW checks (only if not already red)
  else if (daysRunning >= 14 && costPerChatTrend !== null && costPerChatTrend > 0.15) {
    health = 'yellow';
    reason = `Decaying — running ${daysRunning}d, cost/chat up ${(costPerChatTrend * 100).toFixed(0)}%. Start replacement.`;
  } else if (daysRunning >= 7 && input.recentCostPerChat !== null && input.recentCostPerChat > 0.40) {
    health = 'yellow';
    reason = `Poor CPA — $${input.recentCostPerChat.toFixed(2)}/chat after ${daysRunning}d. Monitor closely.`;
  }

  return {
    entityId: input.entityId,
    entityName: input.entityName,
    formatCategory: input.formatCategory as FormatCategory | null,
    daysRunning,
    totalSpend: input.totalSpend,
    dailySpend,
    costPerChat: input.recentCostPerChat,
    costPerChatTrend,
    chatRate: input.recentChatRate,
    health,
    reason,
  };
}

// ---------------------------------------------------------------------------
// Format Diversity Monitor
// ---------------------------------------------------------------------------

export interface FormatDiversityResult {
  /** Number of distinct format categories among active ads */
  distinctFormats: number;
  /** Whether diversity is sufficient (>= 3 formats) */
  sufficient: boolean;
  /** Active format categories with ad counts */
  activeFormats: Array<{ category: FormatCategory; label: string; count: number }>;
  /** Format categories with zero active ads (opportunities) */
  missingFormats: Array<{ category: FormatCategory; label: string }>;
  /** Alert message if diversity is insufficient */
  alert: string | null;
  /** Full coverage analysis including saturation levels */
  coverage: FormatCoverage[];
}

/**
 * Analyze format diversity among active ads.
 *
 * Rules:
 * - 3+ distinct formats running = sufficient (no alert)
 * - 2 formats = warning
 * - 1 format = critical
 * - 0 formats = no ads (edge case)
 */
export function analyzeFormatDiversity(
  ads: Array<{ format_category: string | null; status?: string }>
): FormatDiversityResult {
  // Count distinct format categories (excluding null/other)
  const formatCounts = new Map<FormatCategory, number>();
  for (const ad of ads) {
    const cat = ad.format_category as FormatCategory | null;
    if (cat && cat !== 'other') {
      formatCounts.set(cat, (formatCounts.get(cat) ?? 0) + 1);
    }
  }

  const activeFormats = Array.from(formatCounts.entries())
    .map(([category, count]) => ({
      category,
      label: FORMAT_LABELS[category],
      count,
    }))
    .sort((a, b) => b.count - a.count);

  const distinctFormats = activeFormats.length;
  const sufficient = distinctFormats >= 3;

  // Find missing formats (from all categories)
  const allCategories = Object.keys(FORMAT_LABELS) as FormatCategory[];
  const missingFormats = allCategories
    .filter(cat => cat !== 'other' && !formatCounts.has(cat))
    .map(cat => ({ category: cat, label: FORMAT_LABELS[cat] }));

  // Full coverage analysis
  const coverage = analyzeFormatCoverage(ads);

  let alert: string | null = null;
  if (distinctFormats === 0) {
    alert = 'No format tags on active ads. Run backfill to tag existing ads.';
  } else if (distinctFormats === 1) {
    alert = `Only 1 format running (${activeFormats[0].label}). Creative fatigue risk is high — add 2+ different formats immediately.`;
  } else if (distinctFormats === 2) {
    alert = `Only 2 formats running (${activeFormats.map(f => f.label).join(', ')}). Add at least 1 more format to protect against fatigue cliffs.`;
  }

  return {
    distinctFormats,
    sufficient,
    activeFormats,
    missingFormats,
    alert,
    coverage,
  };
}
