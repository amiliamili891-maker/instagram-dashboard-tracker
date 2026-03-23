import { describe, it, expect } from 'vitest';
import { evaluateKillRules, type KillRuleInput, KILL_RULE_THRESHOLDS } from './kill-rules';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAd(overrides: Partial<KillRuleInput> = {}): KillRuleInput {
  return {
    entityId: 'ad-001',
    entityName: 'Test Ad',
    spend: 0,
    impressions: 1000,
    clicks: 50,
    chats: 10,
    ctr: 5.0,
    costPerChat: 0.15,
    frequency: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('evaluateKillRules', () => {
  // -- low_ctr --

  it('does NOT trigger low_ctr kill when spend is below $15 threshold', () => {
    const ad = makeAd({ spend: 10, ctr: 2.0 });
    const result = evaluateKillRules([ad]);
    const lowCtrKills = result.violations.filter(v => v.rule === 'low_ctr');
    expect(lowCtrKills).toHaveLength(0);
  });

  it('triggers low_ctr kill when CTR is 2% with $20 spend', () => {
    const ad = makeAd({ spend: 20, ctr: 2.0 });
    const result = evaluateKillRules([ad]);
    const lowCtrKills = result.violations.filter(v => v.rule === 'low_ctr');
    expect(lowCtrKills).toHaveLength(1);
    expect(lowCtrKills[0].action).toBe('kill');
    expect(lowCtrKills[0].value).toBe(2.0);
    expect(lowCtrKills[0].threshold).toBe(3);
  });

  it('does NOT trigger low_ctr kill when CTR is 4% with $20 spend', () => {
    const ad = makeAd({ spend: 20, ctr: 4.0 });
    const result = evaluateKillRules([ad]);
    const lowCtrKills = result.violations.filter(v => v.rule === 'low_ctr');
    expect(lowCtrKills).toHaveLength(0);
  });

  it('triggers low_ctr at exactly $15 spend threshold', () => {
    const ad = makeAd({ spend: 15, ctr: 2.5 });
    const result = evaluateKillRules([ad]);
    const lowCtrKills = result.violations.filter(v => v.rule === 'low_ctr');
    expect(lowCtrKills).toHaveLength(1);
    expect(lowCtrKills[0].action).toBe('kill');
  });

  // -- high_cpa --

  it('triggers high_cpa kill when cost/chat is $0.50 with $30 spend', () => {
    const ad = makeAd({ spend: 30, costPerChat: 0.50, chats: 60 });
    const result = evaluateKillRules([ad]);
    const highCpa = result.violations.filter(v => v.rule === 'high_cpa');
    expect(highCpa).toHaveLength(1);
    expect(highCpa[0].action).toBe('kill');
    expect(highCpa[0].threshold).toBe(0.34);
  });

  it('does NOT trigger high_cpa when cost/chat is $0.15', () => {
    const ad = makeAd({ spend: 30, costPerChat: 0.15, chats: 200 });
    const result = evaluateKillRules([ad]);
    const highCpa = result.violations.filter(v => v.rule === 'high_cpa');
    expect(highCpa).toHaveLength(0);
  });

  it('does NOT trigger high_cpa when spend is below $25 threshold', () => {
    const ad = makeAd({ spend: 20, costPerChat: 0.50, chats: 40 });
    const result = evaluateKillRules([ad]);
    const highCpa = result.violations.filter(v => v.rule === 'high_cpa');
    expect(highCpa).toHaveLength(0);
  });

  // -- extreme_cpa --

  it('triggers extreme_cpa kill when cost/chat is $0.70 with $15 spend', () => {
    const ad = makeAd({ spend: 15, costPerChat: 0.70, chats: 21 });
    const result = evaluateKillRules([ad]);
    const extreme = result.violations.filter(v => v.rule === 'extreme_cpa');
    expect(extreme).toHaveLength(1);
    expect(extreme[0].action).toBe('kill');
    expect(extreme[0].threshold).toBe(0.60);
  });

  // -- no_chats --

  it('triggers no_chats kill when $25 spent with 0 chats', () => {
    const ad = makeAd({ spend: 25, chats: 0, costPerChat: null });
    const result = evaluateKillRules([ad]);
    const noChats = result.violations.filter(v => v.rule === 'no_chats');
    expect(noChats).toHaveLength(1);
    expect(noChats[0].action).toBe('kill');
    expect(noChats[0].message).toContain('Zero chats');
  });

  it('does NOT trigger no_chats when spend is $10 with 0 chats', () => {
    const ad = makeAd({ spend: 10, chats: 0, costPerChat: null });
    const result = evaluateKillRules([ad]);
    const noChats = result.violations.filter(v => v.rule === 'no_chats');
    expect(noChats).toHaveLength(0);
  });

  // -- high_cpa_warn --

  it('triggers high_cpa_warn when cost/chat is $0.45 with $12 spend', () => {
    const ad = makeAd({ spend: 12, costPerChat: 0.45, chats: 26 });
    const result = evaluateKillRules([ad]);
    const warn = result.violations.filter(v => v.rule === 'high_cpa_warn');
    expect(warn).toHaveLength(1);
    expect(warn[0].action).toBe('warn');
  });

  // -- low_ctr_warn --

  it('triggers low_ctr_warn when CTR is 4.5% with $12 spend', () => {
    const ad = makeAd({ spend: 12, ctr: 4.5 });
    const result = evaluateKillRules([ad]);
    const warn = result.violations.filter(v => v.rule === 'low_ctr_warn');
    expect(warn).toHaveLength(1);
    expect(warn[0].action).toBe('warn');
  });

  // -- Multiple rules on same ad --

  it('fires multiple rules on the same ad', () => {
    // CTR 1% + cost/chat $0.80 + $30 spend → should trigger low_ctr, high_cpa, extreme_cpa, high_cpa_warn, low_ctr_warn
    const ad = makeAd({ spend: 30, ctr: 1.0, costPerChat: 0.80, chats: 37 });
    const result = evaluateKillRules([ad]);
    const rules = result.violations.map(v => v.rule);
    expect(rules).toContain('low_ctr');
    expect(rules).toContain('high_cpa');
    expect(rules).toContain('extreme_cpa');
    expect(rules).toContain('high_cpa_warn');
    expect(rules).toContain('low_ctr_warn');
    expect(result.violations.length).toBeGreaterThanOrEqual(5);
  });

  // -- Empty input --

  it('returns zero violations for empty input', () => {
    const result = evaluateKillRules([]);
    expect(result.violations).toHaveLength(0);
    expect(result.adsChecked).toBe(0);
    expect(result.adsKilled).toBe(0);
    expect(result.adsWarned).toBe(0);
  });

  // -- Null metrics handled gracefully --

  it('handles null CTR gracefully (skips CTR-based rules)', () => {
    const ad = makeAd({ spend: 30, ctr: null, costPerChat: 0.15, chats: 200 });
    const result = evaluateKillRules([ad]);
    const ctrRules = result.violations.filter(v => v.metric === 'ctr');
    expect(ctrRules).toHaveLength(0);
  });

  it('handles null costPerChat gracefully (skips CPA-based rules)', () => {
    const ad = makeAd({ spend: 30, costPerChat: null, chats: 5 });
    const result = evaluateKillRules([ad]);
    const cpaRules = result.violations.filter(v => v.metric === 'cost_per_chat');
    expect(cpaRules).toHaveLength(0);
  });

  // -- Sorting --

  it('sorts kill violations before warn violations', () => {
    const ads = [
      makeAd({ entityId: 'warn-ad', spend: 12, ctr: 4.5, costPerChat: 0.15, chats: 80 }), // only warn
      makeAd({ entityId: 'kill-ad', spend: 20, ctr: 1.0, costPerChat: 0.15, chats: 133 }),  // kill
    ];
    const result = evaluateKillRules(ads);
    expect(result.violations.length).toBeGreaterThan(0);

    const firstKillIdx = result.violations.findIndex(v => v.action === 'kill');
    const lastKillIdx = result.violations.map(v => v.action).lastIndexOf('kill');
    const firstWarnIdx = result.violations.findIndex(v => v.action === 'warn');

    if (firstKillIdx >= 0 && firstWarnIdx >= 0) {
      expect(lastKillIdx).toBeLessThan(firstWarnIdx);
    }
  });

  // -- Counts --

  it('counts adsKilled and adsWarned correctly across multiple ads', () => {
    const ads = [
      makeAd({ entityId: 'ad-kill', spend: 20, ctr: 1.0, costPerChat: 0.15, chats: 133 }),
      makeAd({ entityId: 'ad-warn', spend: 12, ctr: 4.5, costPerChat: 0.15, chats: 80 }),
      makeAd({ entityId: 'ad-clean', spend: 30, ctr: 8.0, costPerChat: 0.10, chats: 300 }),
    ];
    const result = evaluateKillRules(ads);
    expect(result.adsChecked).toBe(3);
    expect(result.adsKilled).toBe(1);   // ad-kill
    expect(result.adsWarned).toBe(2);   // ad-kill (also has warn rules) + ad-warn
  });

  // -- Thresholds exported --

  it('exports KILL_RULE_THRESHOLDS with correct values', () => {
    expect(KILL_RULE_THRESHOLDS.low_ctr.threshold).toBe(3);
    expect(KILL_RULE_THRESHOLDS.high_cpa.threshold).toBe(0.34);
    expect(KILL_RULE_THRESHOLDS.extreme_cpa.threshold).toBe(0.60);
    expect(KILL_RULE_THRESHOLDS.no_chats.minSpend).toBe(20);
    expect(KILL_RULE_THRESHOLDS.high_cpa_warn.threshold).toBe(0.40);
    expect(KILL_RULE_THRESHOLDS.low_ctr_warn.threshold).toBe(5);
  });
});
