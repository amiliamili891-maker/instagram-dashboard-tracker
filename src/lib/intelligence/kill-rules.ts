/**
 * Auto-Kill Rule Engine
 *
 * Binary circuit breakers that flag ads for immediate action based on hard
 * spend/performance thresholds. Unlike the tier classifier (which grades
 * performance on a spectrum), kill rules are non-negotiable cutoffs:
 * an ad either triggers a rule or it doesn't.
 *
 * Rules are evaluated in priority order. Each ad can trigger multiple rules.
 * Results are sorted: kills first, then warns, then by spend descending.
 *
 * Deterministic, rule-based — no LLM calls.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type KillRuleAction = 'kill' | 'warn';

export interface KillRuleViolation {
  entityId: string;
  entityName: string | null;
  rule: string;
  action: KillRuleAction;
  message: string;
  metric: string;
  value: number;
  threshold: number;
  spend: number;
}

export interface KillRuleInput {
  entityId: string;
  entityName: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  chats: number;
  ctr: number | null;
  costPerChat: number | null;
  frequency: number | null;
}

export interface KillRuleResult {
  violations: KillRuleViolation[];
  adsChecked: number;
  adsKilled: number;
  adsWarned: number;
}

// ---------------------------------------------------------------------------
// Thresholds (exported for UI display)
// ---------------------------------------------------------------------------

export const KILL_RULE_THRESHOLDS = {
  low_ctr: { minSpend: 15, threshold: 3, unit: '%', action: 'kill' as const },
  high_cpa: { minSpend: 25, threshold: 0.34, unit: '$', action: 'kill' as const },
  extreme_cpa: { minSpend: 15, threshold: 0.60, unit: '$', action: 'kill' as const },
  no_chats: { minSpend: 20, threshold: 0, unit: 'chats', action: 'kill' as const },
  high_cpa_warn: { minSpend: 10, threshold: 0.40, unit: '$', action: 'warn' as const },
  low_ctr_warn: { minSpend: 10, threshold: 5, unit: '%', action: 'warn' as const },
} as const;

// ---------------------------------------------------------------------------
// Rule Evaluation
// ---------------------------------------------------------------------------

function evaluateAdKillRules(ad: KillRuleInput): KillRuleViolation[] {
  const violations: KillRuleViolation[] = [];

  // 1. low_ctr — CTR < 3% after $15 spend → kill
  if (ad.ctr !== null && ad.spend >= KILL_RULE_THRESHOLDS.low_ctr.minSpend && ad.ctr < KILL_RULE_THRESHOLDS.low_ctr.threshold) {
    violations.push({
      entityId: ad.entityId,
      entityName: ad.entityName,
      rule: 'low_ctr',
      action: 'kill',
      message: `CTR ${ad.ctr.toFixed(2)}% after $${ad.spend.toFixed(2)} spent. Below 3% minimum. Kill immediately.`,
      metric: 'ctr',
      value: ad.ctr,
      threshold: KILL_RULE_THRESHOLDS.low_ctr.threshold,
      spend: ad.spend,
    });
  }

  // 2. high_cpa — Cost per chat > 2x target ($0.34) after $25 spend → kill
  if (ad.costPerChat !== null && ad.spend >= KILL_RULE_THRESHOLDS.high_cpa.minSpend && ad.costPerChat > KILL_RULE_THRESHOLDS.high_cpa.threshold) {
    violations.push({
      entityId: ad.entityId,
      entityName: ad.entityName,
      rule: 'high_cpa',
      action: 'kill',
      message: `Cost/chat $${ad.costPerChat.toFixed(2)} after $${ad.spend.toFixed(2)} spent. Over 2x target ($0.34). Kill immediately.`,
      metric: 'cost_per_chat',
      value: ad.costPerChat,
      threshold: KILL_RULE_THRESHOLDS.high_cpa.threshold,
      spend: ad.spend,
    });
  }

  // 3. extreme_cpa — Cost per chat > $0.60 after $15 spend → kill
  if (ad.costPerChat !== null && ad.spend >= KILL_RULE_THRESHOLDS.extreme_cpa.minSpend && ad.costPerChat > KILL_RULE_THRESHOLDS.extreme_cpa.threshold) {
    violations.push({
      entityId: ad.entityId,
      entityName: ad.entityName,
      rule: 'extreme_cpa',
      action: 'kill',
      message: `Cost/chat $${ad.costPerChat.toFixed(2)} — critical. Kill immediately.`,
      metric: 'cost_per_chat',
      value: ad.costPerChat,
      threshold: KILL_RULE_THRESHOLDS.extreme_cpa.threshold,
      spend: ad.spend,
    });
  }

  // 4. no_chats — $20+ spent with 0 chats → kill
  if (ad.spend >= KILL_RULE_THRESHOLDS.no_chats.minSpend && ad.chats === 0) {
    violations.push({
      entityId: ad.entityId,
      entityName: ad.entityName,
      rule: 'no_chats',
      action: 'kill',
      message: `Zero chats after $${ad.spend.toFixed(2)} spent. Landing page or tracking broken. Kill and investigate.`,
      metric: 'chats',
      value: 0,
      threshold: KILL_RULE_THRESHOLDS.no_chats.threshold,
      spend: ad.spend,
    });
  }

  // 5. high_cpa_warn — Cost per chat > $0.40 after $10 spend → warn
  if (ad.costPerChat !== null && ad.spend >= KILL_RULE_THRESHOLDS.high_cpa_warn.minSpend && ad.costPerChat > KILL_RULE_THRESHOLDS.high_cpa_warn.threshold) {
    violations.push({
      entityId: ad.entityId,
      entityName: ad.entityName,
      rule: 'high_cpa_warn',
      action: 'warn',
      message: `Cost/chat $${ad.costPerChat.toFixed(2)} trending above target. Monitor for 24h before killing.`,
      metric: 'cost_per_chat',
      value: ad.costPerChat,
      threshold: KILL_RULE_THRESHOLDS.high_cpa_warn.threshold,
      spend: ad.spend,
    });
  }

  // 6. low_ctr_warn — CTR < 5% after $10 spend → warn
  if (ad.ctr !== null && ad.spend >= KILL_RULE_THRESHOLDS.low_ctr_warn.minSpend && ad.ctr < KILL_RULE_THRESHOLDS.low_ctr_warn.threshold) {
    violations.push({
      entityId: ad.entityId,
      entityName: ad.entityName,
      rule: 'low_ctr_warn',
      action: 'warn',
      message: `CTR ${ad.ctr.toFixed(2)}% below 5%. Creative may not be resonating. Monitor.`,
      metric: 'ctr',
      value: ad.ctr,
      threshold: KILL_RULE_THRESHOLDS.low_ctr_warn.threshold,
      spend: ad.spend,
    });
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Main Evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate kill rules across all ads.
 *
 * Returns all violations sorted by action (kills first) then by spend descending.
 */
export function evaluateKillRules(ads: KillRuleInput[]): KillRuleResult {
  const allViolations: KillRuleViolation[] = [];
  const killedIds = new Set<string>();
  const warnedIds = new Set<string>();

  for (const ad of ads) {
    const violations = evaluateAdKillRules(ad);
    for (const v of violations) {
      allViolations.push(v);
      if (v.action === 'kill') {
        killedIds.add(v.entityId);
      } else {
        warnedIds.add(v.entityId);
      }
    }
  }

  // Sort: kills first, then warns; within each group by spend descending
  allViolations.sort((a, b) => {
    if (a.action !== b.action) {
      return a.action === 'kill' ? -1 : 1;
    }
    return b.spend - a.spend;
  });

  return {
    violations: allViolations,
    adsChecked: ads.length,
    adsKilled: killedIds.size,
    adsWarned: warnedIds.size,
  };
}
