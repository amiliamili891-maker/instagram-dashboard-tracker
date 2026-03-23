import { describe, it, expect } from 'vitest';
import {
  scoreAdHealth,
  analyzeFormatDiversity,
  type AdHealthInput,
} from './creative-health';

// ---------------------------------------------------------------------------
// Helper to create AdHealthInput with defaults
// ---------------------------------------------------------------------------

function makeInput(overrides: Partial<AdHealthInput> = {}): AdHealthInput {
  const now = new Date();
  const daysAgo = (n: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  };

  return {
    entityId: 'ad_001',
    entityName: 'Test Ad',
    formatCategory: 'ghostpin',
    firstDate: daysAgo(7),
    lastDate: daysAgo(0),
    totalSpend: 50,
    daysWithData: 7,
    recentCostPerChat: 0.20,
    priorCostPerChat: 0.18,
    recentChatRate: 0.65,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// scoreAdHealth
// ---------------------------------------------------------------------------

describe('scoreAdHealth', () => {
  it('returns green for healthy ad', () => {
    const result = scoreAdHealth(makeInput());
    expect(result.health).toBe('green');
    expect(result.reason).toContain('Healthy');
  });

  it('returns yellow for insufficient spend (< $5)', () => {
    const result = scoreAdHealth(makeInput({ totalSpend: 3 }));
    expect(result.health).toBe('yellow');
    expect(result.reason).toContain('Insufficient data');
  });

  it('returns red for 21+ day ad with CPA trending up >30%', () => {
    const now = new Date();
    const daysAgo = (n: number) => {
      const d = new Date(now);
      d.setDate(d.getDate() - n);
      return d.toISOString().slice(0, 10);
    };
    const result = scoreAdHealth(makeInput({
      firstDate: daysAgo(25),
      recentCostPerChat: 0.35,
      priorCostPerChat: 0.20,  // 75% increase
    }));
    expect(result.health).toBe('red');
    expect(result.reason).toContain('Fatigued');
    expect(result.reason).toContain('cost/chat up');
  });

  it('returns red for 21+ day ad with chat rate < 40%', () => {
    const now = new Date();
    const daysAgo = (n: number) => {
      const d = new Date(now);
      d.setDate(d.getDate() - n);
      return d.toISOString().slice(0, 10);
    };
    const result = scoreAdHealth(makeInput({
      firstDate: daysAgo(25),
      recentChatRate: 0.30,
    }));
    expect(result.health).toBe('red');
    expect(result.reason).toContain('chat rate');
    expect(result.reason).toContain('30%');
  });

  it('returns red for 14+ day ad with CPA > $0.60', () => {
    const now = new Date();
    const daysAgo = (n: number) => {
      const d = new Date(now);
      d.setDate(d.getDate() - n);
      return d.toISOString().slice(0, 10);
    };
    const result = scoreAdHealth(makeInput({
      firstDate: daysAgo(16),
      recentCostPerChat: 0.75,
    }));
    expect(result.health).toBe('red');
    expect(result.reason).toContain('Critical CPA');
  });

  it('returns yellow for 14+ day ad with CPA trending up 15-30%', () => {
    const now = new Date();
    const daysAgo = (n: number) => {
      const d = new Date(now);
      d.setDate(d.getDate() - n);
      return d.toISOString().slice(0, 10);
    };
    const result = scoreAdHealth(makeInput({
      firstDate: daysAgo(16),
      recentCostPerChat: 0.25,
      priorCostPerChat: 0.20,  // 25% increase
    }));
    expect(result.health).toBe('yellow');
    expect(result.reason).toContain('Decaying');
  });

  it('returns yellow for 7+ day ad with CPA > $0.40', () => {
    const result = scoreAdHealth(makeInput({
      recentCostPerChat: 0.45,
    }));
    expect(result.health).toBe('yellow');
    expect(result.reason).toContain('Poor CPA');
  });

  it('returns green for new ad (< 7 days) even with mediocre CPA', () => {
    const now = new Date();
    const daysAgo = (n: number) => {
      const d = new Date(now);
      d.setDate(d.getDate() - n);
      return d.toISOString().slice(0, 10);
    };
    const result = scoreAdHealth(makeInput({
      firstDate: daysAgo(3),
      recentCostPerChat: 0.45,
    }));
    expect(result.health).toBe('green');
  });

  it('calculates daysRunning correctly', () => {
    const now = new Date();
    const tenDaysAgo = new Date(now);
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
    const result = scoreAdHealth(makeInput({
      firstDate: tenDaysAgo.toISOString().slice(0, 10),
    }));
    expect(result.daysRunning).toBeGreaterThanOrEqual(10);
    expect(result.daysRunning).toBeLessThanOrEqual(11);
  });

  it('calculates costPerChatTrend correctly', () => {
    const result = scoreAdHealth(makeInput({
      recentCostPerChat: 0.30,
      priorCostPerChat: 0.20,
    }));
    expect(result.costPerChatTrend).toBeCloseTo(0.50, 2); // 50% increase
  });

  it('handles null CPA values gracefully', () => {
    const result = scoreAdHealth(makeInput({
      recentCostPerChat: null,
      priorCostPerChat: null,
    }));
    expect(result.health).toBe('green');
    expect(result.costPerChatTrend).toBeNull();
  });

  it('handles null chat rate gracefully', () => {
    const result = scoreAdHealth(makeInput({
      recentChatRate: null,
    }));
    expect(result.health).toBe('green');
  });
});

// ---------------------------------------------------------------------------
// analyzeFormatDiversity
// ---------------------------------------------------------------------------

describe('analyzeFormatDiversity', () => {
  it('returns sufficient=true with 3+ formats', () => {
    const ads = [
      { format_category: 'ghostpin' },
      { format_category: 'notification' },
      { format_category: 'chat' },
    ];
    const result = analyzeFormatDiversity(ads);
    expect(result.sufficient).toBe(true);
    expect(result.distinctFormats).toBe(3);
    expect(result.alert).toBeNull();
  });

  it('returns sufficient=false with 2 formats and generates alert', () => {
    const ads = [
      { format_category: 'ghostpin' },
      { format_category: 'ghostpin' },
      { format_category: 'notification' },
    ];
    const result = analyzeFormatDiversity(ads);
    expect(result.sufficient).toBe(false);
    expect(result.distinctFormats).toBe(2);
    expect(result.alert).toContain('Only 2 formats');
  });

  it('returns critical alert with 1 format', () => {
    const ads = [
      { format_category: 'ghostpin' },
      { format_category: 'ghostpin' },
    ];
    const result = analyzeFormatDiversity(ads);
    expect(result.sufficient).toBe(false);
    expect(result.distinctFormats).toBe(1);
    expect(result.alert).toContain('Only 1 format');
    expect(result.alert).toContain('fatigue risk');
  });

  it('handles no tagged ads', () => {
    const ads = [
      { format_category: null },
      { format_category: null },
    ];
    const result = analyzeFormatDiversity(ads);
    expect(result.distinctFormats).toBe(0);
    expect(result.alert).toContain('No format tags');
  });

  it('ignores "other" category', () => {
    const ads = [
      { format_category: 'ghostpin' },
      { format_category: 'other' },
      { format_category: 'notification' },
    ];
    const result = analyzeFormatDiversity(ads);
    expect(result.distinctFormats).toBe(2);
  });

  it('sorts activeFormats by count descending', () => {
    const ads = [
      { format_category: 'ghostpin' },
      { format_category: 'ghostpin' },
      { format_category: 'ghostpin' },
      { format_category: 'notification' },
      { format_category: 'chat' },
      { format_category: 'chat' },
    ];
    const result = analyzeFormatDiversity(ads);
    expect(result.activeFormats[0].category).toBe('ghostpin');
    expect(result.activeFormats[0].count).toBe(3);
    expect(result.activeFormats[1].category).toBe('chat');
    expect(result.activeFormats[1].count).toBe(2);
  });

  it('lists missing formats', () => {
    const ads = [
      { format_category: 'ghostpin' },
      { format_category: 'notification' },
    ];
    const result = analyzeFormatDiversity(ads);
    expect(result.missingFormats.length).toBeGreaterThan(10);
    expect(result.missingFormats.find(f => f.category === 'ghostpin')).toBeUndefined();
    expect(result.missingFormats.find(f => f.category === 'chat')).toBeDefined();
  });

  it('includes full coverage analysis', () => {
    const ads = [
      { format_category: 'ghostpin' },
    ];
    const result = analyzeFormatDiversity(ads);
    expect(result.coverage.length).toBeGreaterThan(0);
    const ghostpin = result.coverage.find(c => c.category === 'ghostpin');
    expect(ghostpin?.count).toBe(1);
    expect(ghostpin?.saturation).toBe('light');
  });
});
