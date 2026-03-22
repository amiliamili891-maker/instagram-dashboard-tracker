/**
 * Intelligence Pass Runner
 *
 * Runs all 4 intelligence modules sequentially after a successful sync.
 * Each module is isolated — one failing does not block the others.
 *
 * Modules:
 *   1. Anomaly Detector — 3-day vs prior 3-day comparison
 *   2. Tier Classifier — composite performance tiering
 *   3. Mismatch Detector — creative-funnel divergence
 *   4. Budget Advisor — spend reallocation recommendations
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  detectAnomalies,
  type AnomalyPersistence,
  type EntityWindowMetrics,
  type DateRange,
} from './anomaly-detector';
import {
  runTierClassification,
  type TierPersistence,
  type EntityMetrics,
  type TierResult,
} from './tier-classifier';
import {
  detectMismatches,
  type MismatchPersistence,
  type MismatchEntityInput,
} from './mismatch-detector';
import {
  generateBudgetRecommendations,
  type BudgetPersistence,
  type BudgetEntityInput,
} from './budget-advisor';
import type { FreshnessState } from '@/lib/sync/freshness';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IntelligencePassResult {
  anomalies: number;
  tiers: number;
  mismatches: number;
  budgetRecs: number;
  errors: string[];
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Persistence Factories
// ---------------------------------------------------------------------------

function createAnomalyPersistence(client: SupabaseClient): AnomalyPersistence {
  return {
    async fetchEntityMetrics(dateRange: DateRange): Promise<EntityWindowMetrics[]> {
      const { data, error } = await client
        .from('daily_combined_stats')
        .select(
          'entity_id, entity_level, spend, visits, chats, reveals, chat_rate, cost_per_chat, reveal_rate',
        )
        .gte('report_date', dateRange.from)
        .lte('report_date', dateRange.to);

      if (error || !data) return [];

      // Aggregate by entity
      const entityMap = new Map<
        string,
        {
          entityId: string;
          entityLevel: 'campaign' | 'adset' | 'ad';
          totalSpend: number;
          totalVisits: number;
          totalChats: number;
          totalReveals: number;
        }
      >();

      for (const row of data) {
        const key = `${row.entity_id}:${row.entity_level}`;
        const existing = entityMap.get(key);
        if (existing) {
          existing.totalSpend += row.spend ?? 0;
          existing.totalVisits += row.visits ?? 0;
          existing.totalChats += row.chats ?? 0;
          existing.totalReveals += row.reveals ?? 0;
        } else {
          entityMap.set(key, {
            entityId: row.entity_id,
            entityLevel: row.entity_level,
            totalSpend: row.spend ?? 0,
            totalVisits: row.visits ?? 0,
            totalChats: row.chats ?? 0,
            totalReveals: row.reveals ?? 0,
          });
        }
      }

      return Array.from(entityMap.values()).map((e) => ({
        entityId: e.entityId,
        entityLevel: e.entityLevel,
        spend: e.totalSpend,
        visits: e.totalVisits,
        chats: e.totalChats,
        reveals: e.totalReveals,
        chat_rate: e.totalVisits > 0 ? e.totalChats / e.totalVisits : null,
        cost_per_chat: e.totalChats > 0 ? e.totalSpend / e.totalChats : null,
        reveal_rate: e.totalChats > 0 ? e.totalReveals / e.totalChats : null,
      }));
    },
  };
}

function createTierPersistence(client: SupabaseClient): TierPersistence {
  return {
    async fetchActiveEntities(): Promise<EntityMetrics[]> {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const dateFrom = sevenDaysAgo.toISOString().slice(0, 10);
      const dateTo = new Date().toISOString().slice(0, 10);

      const { data, error } = await client
        .from('daily_combined_stats')
        .select(
          'entity_id, entity_level, visits, chat_rate, cost_per_chat, reveal_rate, freshness_state',
        )
        .gte('report_date', dateFrom)
        .lte('report_date', dateTo)
        .eq('entity_level', 'ad');

      if (error || !data) return [];

      // Aggregate by entity (sum visits, use latest rates)
      const entityMap = new Map<string, EntityMetrics>();
      for (const row of data) {
        const key = `${row.entity_id}:${row.entity_level}`;
        const existing = entityMap.get(key);
        if (existing) {
          existing.visits += row.visits ?? 0;
        } else {
          entityMap.set(key, {
            entityId: row.entity_id,
            entityLevel: row.entity_level,
            chat_rate: row.chat_rate,
            cost_per_chat: row.cost_per_chat,
            reveal_rate: row.reveal_rate,
            visits: row.visits ?? 0,
            freshnessState: row.freshness_state as FreshnessState | null,
          });
        }
      }

      return Array.from(entityMap.values());
    },

    async upsertTierAlerts(results: TierResult[]): Promise<number> {
      if (results.length === 0) return 0;

      const rows = results.map((r) => ({
        entity_id: r.entityId,
        entity_type: r.entityLevel,
        alert_type: 'threshold',
        severity: r.compositeColor === 'red' ? 'critical' : r.compositeColor === 'orange' ? 'warning' : 'info',
        title: `${r.entityLevel} ${r.entityId}: ${r.compositeTier}`,
        message: r.suppressed
          ? r.suppressionReason
          : `Composite tier: ${r.compositeTier} (driven by ${r.drivingMetric})`,
        metadata: {
          compositeTier: r.compositeTier,
          compositeColor: r.compositeColor,
          compositeAction: r.compositeAction,
          drivingMetric: r.drivingMetric,
          metrics: r.metrics,
          suppressed: r.suppressed,
          suppressionReason: r.suppressionReason,
          sampleSize: r.sampleSize,
        },
        created_at: new Date().toISOString(),
      }));

      const { error } = await client
        .from('intelligence_alerts')
        .upsert(rows, {
          onConflict: 'entity_id,entity_type,alert_type',
          ignoreDuplicates: false,
        });

      if (error) {
        console.error('Failed to upsert tier alerts:', error.message);
        return 0;
      }
      return rows.length;
    },
  };
}

function createMismatchPersistence(
  client: SupabaseClient,
): MismatchPersistence {
  return {
    async fetchEntitiesForMismatch(): Promise<MismatchEntityInput[]> {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const dateFrom = sevenDaysAgo.toISOString().slice(0, 10);
      const dateTo = new Date().toISOString().slice(0, 10);

      const { data, error } = await client
        .from('daily_combined_stats')
        .select('entity_id, entity_level, visits, chats, reveals, click_throughs')
        .gte('report_date', dateFrom)
        .lte('report_date', dateTo)
        .eq('entity_level', 'ad');

      if (error || !data) return [];

      // Aggregate by entity
      const entityMap = new Map<
        string,
        {
          entityId: string;
          entityLevel: 'campaign' | 'adset' | 'ad';
          totalVisits: number;
          totalChats: number;
          totalReveals: number;
          totalClickThroughs: number;
        }
      >();

      for (const row of data) {
        const key = `${row.entity_id}:${row.entity_level}`;
        const existing = entityMap.get(key);
        if (existing) {
          existing.totalVisits += row.visits ?? 0;
          existing.totalChats += row.chats ?? 0;
          existing.totalReveals += row.reveals ?? 0;
          existing.totalClickThroughs += row.click_throughs ?? 0;
        } else {
          entityMap.set(key, {
            entityId: row.entity_id,
            entityLevel: row.entity_level,
            totalVisits: row.visits ?? 0,
            totalChats: row.chats ?? 0,
            totalReveals: row.reveals ?? 0,
            totalClickThroughs: row.click_throughs ?? 0,
          });
        }
      }

      return Array.from(entityMap.values()).map((e) => ({
        entityId: e.entityId,
        entityLevel: e.entityLevel,
        chat_rate: e.totalVisits > 0 ? e.totalChats / e.totalVisits : null,
        reveal_rate: e.totalChats > 0 ? e.totalReveals / e.totalChats : null,
        reveal_click_through_rate:
          e.totalReveals > 0 ? e.totalClickThroughs / e.totalReveals : null,
        visits: e.totalVisits,
      }));
    },
  };
}

function createBudgetPersistence(client: SupabaseClient): BudgetPersistence {
  return {
    async fetchEntitiesWithSpend(): Promise<BudgetEntityInput[]> {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const dateFrom = sevenDaysAgo.toISOString().slice(0, 10);
      const dateTo = new Date().toISOString().slice(0, 10);

      const { data, error } = await client
        .from('daily_combined_stats')
        .select(
          'entity_id, entity_level, spend, visits, chats, reveals, click_throughs, chat_rate, cost_per_chat, reveal_rate, freshness_state',
        )
        .gte('report_date', dateFrom)
        .lte('report_date', dateTo)
        .eq('entity_level', 'ad');

      if (error || !data) return [];

      // Aggregate by entity
      const entityMap = new Map<string, BudgetEntityInput>();
      for (const row of data) {
        const key = `${row.entity_id}:${row.entity_level}`;
        const existing = entityMap.get(key);
        if (existing) {
          existing.spend += row.spend ?? 0;
          existing.visits += row.visits ?? 0;
        } else {
          entityMap.set(key, {
            entityId: row.entity_id,
            entityLevel: row.entity_level,
            spend: row.spend ?? 0,
            visits: row.visits ?? 0,
            chat_rate: row.chat_rate,
            cost_per_chat: row.cost_per_chat,
            reveal_rate: row.reveal_rate,
            freshnessState: row.freshness_state as FreshnessState | null,
          });
        }
      }

      return Array.from(entityMap.values());
    },
  };
}

// ---------------------------------------------------------------------------
// Main Runner
// ---------------------------------------------------------------------------

/**
 * Run all 4 intelligence modules against the current data.
 *
 * Catches errors per-module so one failure does not block the others.
 * Returns a summary with counts and timing.
 */
export async function runIntelligencePass(
  client: SupabaseClient,
): Promise<IntelligencePassResult> {
  const start = Date.now();
  const errors: string[] = [];
  let anomalyCount = 0;
  let tierCount = 0;
  let mismatchCount = 0;
  let budgetRecCount = 0;

  const today = new Date().toISOString().slice(0, 10);

  // 1. Anomaly detection
  try {
    const t0 = Date.now();
    const persistence = createAnomalyPersistence(client);
    const result = await detectAnomalies(persistence, { referenceDate: today });
    anomalyCount = result.anomalies.length;
    console.log(
      `[intelligence] Anomaly detection: ${anomalyCount} anomalies across ${result.entitiesChecked} entities (${Date.now() - t0}ms)`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`anomaly-detector: ${msg}`);
    console.error('[intelligence] Anomaly detection failed:', msg);
  }

  // 2. Tier classification
  try {
    const t0 = Date.now();
    const persistence = createTierPersistence(client);
    const result = await runTierClassification(persistence);
    tierCount = result.classified;
    console.log(
      `[intelligence] Tier classification: ${tierCount} classified, ${result.suppressed} suppressed (${Date.now() - t0}ms)`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`tier-classifier: ${msg}`);
    console.error('[intelligence] Tier classification failed:', msg);
  }

  // 3. Mismatch detection
  try {
    const t0 = Date.now();
    const persistence = createMismatchPersistence(client);
    const result = await detectMismatches(persistence);
    mismatchCount = result.mismatches.length;
    console.log(
      `[intelligence] Mismatch detection: ${mismatchCount} mismatches across ${result.entitiesChecked} entities (${Date.now() - t0}ms)`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`mismatch-detector: ${msg}`);
    console.error('[intelligence] Mismatch detection failed:', msg);
  }

  // 4. Budget recommendations
  try {
    const t0 = Date.now();
    const persistence = createBudgetPersistence(client);
    const result = await generateBudgetRecommendations(persistence);
    budgetRecCount = result.recommendations.length;
    console.log(
      `[intelligence] Budget advisor: ${budgetRecCount} recommendations, $${result.suggestedReallocation.toFixed(2)} reallocation (${Date.now() - t0}ms)`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`budget-advisor: ${msg}`);
    console.error('[intelligence] Budget advisor failed:', msg);
  }

  const durationMs = Date.now() - start;
  console.log(
    `[intelligence] Pass complete in ${durationMs}ms — anomalies:${anomalyCount} tiers:${tierCount} mismatches:${mismatchCount} budgetRecs:${budgetRecCount}${errors.length > 0 ? ` errors:${errors.length}` : ''}`,
  );

  return {
    anomalies: anomalyCount,
    tiers: tierCount,
    mismatches: mismatchCount,
    budgetRecs: budgetRecCount,
    errors,
    durationMs,
  };
}
