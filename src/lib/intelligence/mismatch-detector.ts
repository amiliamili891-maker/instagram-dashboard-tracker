/**
 * Creative-Funnel Mismatch Detector
 *
 * Detects patterns where creative performance and funnel metrics diverge:
 *
 * 1. High reveal_click_through_rate + low chat_rate:
 *    Creative attracts clicks but chat UX fails to engage.
 *
 * 2. High chat_rate + low reveal_rate:
 *    Chat is engaging but reveal prompt is weak.
 *
 * All outputs are advisory only.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MismatchPattern =
  | 'high_click_low_chat'
  | 'high_chat_low_reveal';

export interface Mismatch {
  entityId: string;
  entityLevel: 'campaign' | 'adset' | 'ad';
  pattern: MismatchPattern;
  patternLabel: string;
  metrics: {
    name: string;
    label: string;
    value: number;
    assessment: 'high' | 'low';
  }[];
  message: string;
  recommendation: string;
}

export interface MismatchResult {
  mismatches: Mismatch[];
  entitiesChecked: number;
  entitiesFlagged: number;
}

export interface MismatchEntityInput {
  entityId: string;
  entityLevel: 'campaign' | 'adset' | 'ad';
  chat_rate: number | null;
  reveal_rate: number | null;
  reveal_click_through_rate: number | null;
  visits: number;
}

export interface MismatchThresholds {
  /** Click-through rate considered "high" (default 50%) */
  highClickThroughRate: number;
  /** Chat rate considered "low" in context of high clicks (default 50%) */
  lowChatRate: number;
  /** Chat rate considered "high" (default 70%) */
  highChatRate: number;
  /** Reveal rate considered "low" in context of high chat (default 25%) */
  lowRevealRate: number;
  /** Minimum visits to consider for mismatch detection (default 50) */
  minVisits: number;
}

export const DEFAULT_MISMATCH_THRESHOLDS: MismatchThresholds = {
  highClickThroughRate: 0.50,
  lowChatRate: 0.50,
  highChatRate: 0.70,
  lowRevealRate: 0.25,
  minVisits: 50,
};

export interface MismatchPersistence {
  /** Fetch entities with funnel metrics for mismatch detection */
  fetchEntitiesForMismatch(): Promise<MismatchEntityInput[]>;
}

// ---------------------------------------------------------------------------
// Core Detection
// ---------------------------------------------------------------------------

/**
 * Detect mismatches for a single entity.
 */
export function detectEntityMismatches(
  entity: MismatchEntityInput,
  thresholds: MismatchThresholds = DEFAULT_MISMATCH_THRESHOLDS,
): Mismatch[] {
  const mismatches: Mismatch[] = [];

  // Skip entities with insufficient data
  if (entity.visits < thresholds.minVisits) {
    return mismatches;
  }

  // Pattern 1: High click-through + low chat rate
  // Creative attracts clicks but chat UX fails
  if (
    entity.reveal_click_through_rate !== null &&
    entity.chat_rate !== null &&
    entity.reveal_click_through_rate >= thresholds.highClickThroughRate &&
    entity.chat_rate < thresholds.lowChatRate
  ) {
    const ctrPct = (entity.reveal_click_through_rate * 100).toFixed(1);
    const chatPct = (entity.chat_rate * 100).toFixed(1);

    mismatches.push({
      entityId: entity.entityId,
      entityLevel: entity.entityLevel,
      pattern: 'high_click_low_chat',
      patternLabel: 'High Click-Through, Low Chat Rate',
      metrics: [
        {
          name: 'reveal_click_through_rate',
          label: 'Click-Through Rate',
          value: entity.reveal_click_through_rate,
          assessment: 'high',
        },
        {
          name: 'chat_rate',
          label: 'Chat Rate',
          value: entity.chat_rate,
          assessment: 'low',
        },
      ],
      message:
        `${entity.entityLevel} ${entity.entityId}: Click-through rate is ${ctrPct}% ` +
        `but chat rate is only ${chatPct}%. Creative attracts clicks but chat UX fails to engage.`,
      recommendation:
        'Review the landing page or chat entry experience. The creative is performing well ' +
        'but visitors are not starting chats. Consider A/B testing the chat greeting or page layout.',
    });
  }

  // Pattern 2: High chat rate + low reveal rate
  // Chat is engaging but reveal prompt is weak
  if (
    entity.chat_rate !== null &&
    entity.reveal_rate !== null &&
    entity.chat_rate >= thresholds.highChatRate &&
    entity.reveal_rate < thresholds.lowRevealRate
  ) {
    const chatPct = (entity.chat_rate * 100).toFixed(1);
    const revealPct = (entity.reveal_rate * 100).toFixed(1);

    mismatches.push({
      entityId: entity.entityId,
      entityLevel: entity.entityLevel,
      pattern: 'high_chat_low_reveal',
      patternLabel: 'High Chat Rate, Low Reveal Rate',
      metrics: [
        {
          name: 'chat_rate',
          label: 'Chat Rate',
          value: entity.chat_rate,
          assessment: 'high',
        },
        {
          name: 'reveal_rate',
          label: 'Reveal Rate',
          value: entity.reveal_rate,
          assessment: 'low',
        },
      ],
      message:
        `${entity.entityLevel} ${entity.entityId}: Chat rate is ${chatPct}% ` +
        `but reveal rate is only ${revealPct}%. Chat is engaging but the reveal prompt is weak.`,
      recommendation:
        'Review the AI persona reveal timing and messaging. Visitors are engaging in chat ' +
        'but not reaching the reveal stage. Consider adjusting the reveal trigger or persona behavior.',
    });
  }

  return mismatches;
}

// ---------------------------------------------------------------------------
// Main Detection
// ---------------------------------------------------------------------------

/**
 * Detect creative-funnel mismatches across all entities.
 */
export async function detectMismatches(
  persistence: MismatchPersistence,
  thresholds: MismatchThresholds = DEFAULT_MISMATCH_THRESHOLDS,
): Promise<MismatchResult> {
  const entities = await persistence.fetchEntitiesForMismatch();

  const allMismatches: Mismatch[] = [];
  const flaggedEntities = new Set<string>();

  for (const entity of entities) {
    const entityMismatches = detectEntityMismatches(entity, thresholds);
    if (entityMismatches.length > 0) {
      flaggedEntities.add(`${entity.entityId}:${entity.entityLevel}`);
      allMismatches.push(...entityMismatches);
    }
  }

  return {
    mismatches: allMismatches,
    entitiesChecked: entities.length,
    entitiesFlagged: flaggedEntities.size,
  };
}
