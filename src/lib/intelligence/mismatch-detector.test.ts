/**
 * Tests for Creative-Funnel Mismatch Detector
 *
 * Covers:
 *   - High click-through + low chat rate detection
 *   - High chat rate + low reveal rate detection
 *   - Minimum visits filtering
 *   - No mismatch when metrics are balanced
 *   - Null metric handling
 *   - Full detection flow
 */

import { describe, it, expect, vi } from 'vitest';
import {
  detectEntityMismatches,
  detectMismatches,
  type MismatchEntityInput,
  type MismatchPersistence,
  DEFAULT_MISMATCH_THRESHOLDS,
} from './mismatch-detector';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeEntity(
  overrides: Partial<MismatchEntityInput> = {},
): MismatchEntityInput {
  return {
    entityId: 'ad_001',
    entityLevel: 'ad',
    chat_rate: 0.80,
    reveal_rate: 0.35,
    reveal_click_through_rate: 0.60,
    visits: 200,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// High Click-Through + Low Chat Rate
// ---------------------------------------------------------------------------

describe('detectEntityMismatches — high_click_low_chat', () => {
  it('detects high click-through with low chat rate', () => {
    const entity = makeEntity({
      reveal_click_through_rate: 0.65,  // High (>= 50%)
      chat_rate: 0.40,                   // Low (< 50%)
    });

    const mismatches = detectEntityMismatches(entity);

    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].pattern).toBe('high_click_low_chat');
    expect(mismatches[0].patternLabel).toBe('High Click-Through, Low Chat Rate');
    expect(mismatches[0].message).toContain('65.0%');
    expect(mismatches[0].message).toContain('40.0%');
    expect(mismatches[0].recommendation).toContain('landing page');
  });

  it('does not flag when click-through is low', () => {
    const entity = makeEntity({
      reveal_click_through_rate: 0.30,  // Not high
      chat_rate: 0.40,
    });

    const mismatches = detectEntityMismatches(entity);
    const pattern = mismatches.find((m) => m.pattern === 'high_click_low_chat');
    expect(pattern).toBeUndefined();
  });

  it('does not flag when chat rate is acceptable', () => {
    const entity = makeEntity({
      reveal_click_through_rate: 0.65,
      chat_rate: 0.60,  // Not low (>= 50%)
    });

    const mismatches = detectEntityMismatches(entity);
    const pattern = mismatches.find((m) => m.pattern === 'high_click_low_chat');
    expect(pattern).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// High Chat Rate + Low Reveal Rate
// ---------------------------------------------------------------------------

describe('detectEntityMismatches — high_chat_low_reveal', () => {
  it('detects high chat rate with low reveal rate', () => {
    const entity = makeEntity({
      chat_rate: 0.80,      // High (>= 70%)
      reveal_rate: 0.20,    // Low (< 25%)
    });

    const mismatches = detectEntityMismatches(entity);
    const pattern = mismatches.find((m) => m.pattern === 'high_chat_low_reveal');

    expect(pattern).toBeDefined();
    expect(pattern!.patternLabel).toBe('High Chat Rate, Low Reveal Rate');
    expect(pattern!.message).toContain('80.0%');
    expect(pattern!.message).toContain('20.0%');
    expect(pattern!.recommendation).toContain('reveal');
  });

  it('does not flag when chat rate is moderate', () => {
    const entity = makeEntity({
      chat_rate: 0.60,      // Not high (< 70%)
      reveal_rate: 0.20,
    });

    const mismatches = detectEntityMismatches(entity);
    const pattern = mismatches.find((m) => m.pattern === 'high_chat_low_reveal');
    expect(pattern).toBeUndefined();
  });

  it('does not flag when reveal rate is acceptable', () => {
    const entity = makeEntity({
      chat_rate: 0.80,
      reveal_rate: 0.30,    // Not low (>= 25%)
    });

    const mismatches = detectEntityMismatches(entity);
    const pattern = mismatches.find((m) => m.pattern === 'high_chat_low_reveal');
    expect(pattern).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Both Patterns
// ---------------------------------------------------------------------------

describe('detectEntityMismatches — multiple patterns', () => {
  it('can detect both patterns simultaneously', () => {
    const entity = makeEntity({
      reveal_click_through_rate: 0.60,  // High
      chat_rate: 0.75,                   // High for pattern 2, but also >= 50 so no pattern 1
      reveal_rate: 0.20,                 // Low
    });

    const mismatches = detectEntityMismatches(entity);
    // chat_rate 75% is above 50% so pattern 1 not triggered
    // chat_rate 75% >= 70% and reveal_rate 20% < 25% so pattern 2 triggered
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].pattern).toBe('high_chat_low_reveal');
  });

  it('detects both when chat rate is high enough for clicks but low enough overall', () => {
    const entity = makeEntity({
      reveal_click_through_rate: 0.55,  // High
      chat_rate: 0.40,                   // Low for pattern 1
      reveal_rate: 0.20,                 // Low
    });

    // chat_rate 40% < 50% so pattern 1 triggered
    // chat_rate 40% < 70% so pattern 2 NOT triggered
    const mismatches = detectEntityMismatches(entity);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].pattern).toBe('high_click_low_chat');
  });
});

// ---------------------------------------------------------------------------
// Minimum Visits Filtering
// ---------------------------------------------------------------------------

describe('detectEntityMismatches — minimum visits', () => {
  it('skips entities below minimum visits', () => {
    const entity = makeEntity({
      visits: 10,
      reveal_click_through_rate: 0.80,
      chat_rate: 0.30,
    });

    const mismatches = detectEntityMismatches(entity);
    expect(mismatches).toHaveLength(0);
  });

  it('includes entities at exactly minimum visits', () => {
    const entity = makeEntity({
      visits: 50,
      reveal_click_through_rate: 0.80,
      chat_rate: 0.30,
    });

    const mismatches = detectEntityMismatches(entity);
    expect(mismatches).toHaveLength(1);
  });

  it('supports custom minimum visits threshold', () => {
    const entity = makeEntity({
      visits: 80,
      reveal_click_through_rate: 0.80,
      chat_rate: 0.30,
    });

    const noMatch = detectEntityMismatches(entity, {
      ...DEFAULT_MISMATCH_THRESHOLDS,
      minVisits: 100,
    });
    expect(noMatch).toHaveLength(0);

    const hasMatch = detectEntityMismatches(entity, {
      ...DEFAULT_MISMATCH_THRESHOLDS,
      minVisits: 50,
    });
    expect(hasMatch.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Null Metric Handling
// ---------------------------------------------------------------------------

describe('detectEntityMismatches — null handling', () => {
  it('skips pattern 1 when click-through rate is null', () => {
    const entity = makeEntity({
      reveal_click_through_rate: null,
      chat_rate: 0.30,
    });

    const mismatches = detectEntityMismatches(entity);
    const pattern = mismatches.find((m) => m.pattern === 'high_click_low_chat');
    expect(pattern).toBeUndefined();
  });

  it('skips pattern 2 when reveal rate is null', () => {
    const entity = makeEntity({
      chat_rate: 0.80,
      reveal_rate: null,
    });

    const mismatches = detectEntityMismatches(entity);
    const pattern = mismatches.find((m) => m.pattern === 'high_chat_low_reveal');
    expect(pattern).toBeUndefined();
  });

  it('returns no mismatches when all metrics are null', () => {
    const entity = makeEntity({
      chat_rate: null,
      reveal_rate: null,
      reveal_click_through_rate: null,
    });

    const mismatches = detectEntityMismatches(entity);
    expect(mismatches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// No Mismatch
// ---------------------------------------------------------------------------

describe('detectEntityMismatches — balanced metrics', () => {
  it('returns empty for well-balanced metrics', () => {
    const entity = makeEntity({
      reveal_click_through_rate: 0.60,
      chat_rate: 0.80,
      reveal_rate: 0.35,
    });

    const mismatches = detectEntityMismatches(entity);
    expect(mismatches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Full Detection Flow
// ---------------------------------------------------------------------------

describe('detectMismatches', () => {
  it('detects mismatches across all entities', async () => {
    const entities: MismatchEntityInput[] = [
      // Mismatch: high click-through, low chat
      makeEntity({
        entityId: 'ad_001',
        reveal_click_through_rate: 0.70,
        chat_rate: 0.35,
      }),
      // No mismatch
      makeEntity({
        entityId: 'ad_002',
        reveal_click_through_rate: 0.50,
        chat_rate: 0.80,
        reveal_rate: 0.35,
      }),
      // Mismatch: high chat, low reveal
      makeEntity({
        entityId: 'ad_003',
        chat_rate: 0.85,
        reveal_rate: 0.15,
      }),
    ];

    const persistence: MismatchPersistence = {
      fetchEntitiesForMismatch: vi.fn().mockResolvedValue(entities),
    };

    const result = await detectMismatches(persistence);

    expect(result.entitiesChecked).toBe(3);
    expect(result.entitiesFlagged).toBe(2);
    expect(result.mismatches).toHaveLength(2);

    const patterns = result.mismatches.map((m) => m.pattern);
    expect(patterns).toContain('high_click_low_chat');
    expect(patterns).toContain('high_chat_low_reveal');
  });

  it('returns empty when no entities have mismatches', async () => {
    const persistence: MismatchPersistence = {
      fetchEntitiesForMismatch: vi.fn().mockResolvedValue([
        makeEntity({ chat_rate: 0.80, reveal_rate: 0.35 }),
      ]),
    };

    const result = await detectMismatches(persistence);

    expect(result.mismatches).toHaveLength(0);
    expect(result.entitiesFlagged).toBe(0);
  });
});
