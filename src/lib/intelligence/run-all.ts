/**
 * Intelligence Pass Runner
 *
 * Runs all 6 intelligence modules sequentially after a successful sync.
 * Each module is isolated — one failing does not block the others.
 *
 * Modules:
 *   1. Anomaly Detector — 3-day vs prior 3-day comparison
 *   2. Tier Classifier — composite performance tiering
 *   3. Mismatch Detector — creative-funnel divergence
 *   4. Budget Advisor — spend reallocation recommendations
 *   5. Creative Health — ad fatigue scoring + format diversity
 *   6. Kill Rules — binary circuit breakers for immediate action
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
import {
  scoreAdHealth,
  type AdHealthInput,
  type AdHealthScore,
} from './creative-health';
import {
  evaluateKillRules,
  type KillRuleInput,
} from './kill-rules';
import type { FreshnessState } from '@/lib/sync/freshness';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IntelligencePassResult {
  anomalies: number;
  tiers: number;
  mismatches: number;
  budgetRecs: number;
  healthScores: number;
  killRules: number;
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
          'entity_id, entity_level, visits, chats, reveals, spend, freshness_state',
        )
        .gte('report_date', dateFrom)
        .lte('report_date', dateTo)
        .eq('entity_level', 'ad');

      if (error || !data) return [];

      // Aggregate by entity — accumulate raw totals, then compute rates
      const entityMap = new Map<string, {
        entityId: string;
        entityLevel: 'campaign' | 'adset' | 'ad';
        visits: number;
        chats: number;
        reveals: number;
        spend: number;
        freshnessState: FreshnessState | null;
      }>();
      for (const row of data) {
        const key = `${row.entity_id}:${row.entity_level}`;
        const existing = entityMap.get(key);
        if (existing) {
          existing.visits += row.visits ?? 0;
          existing.chats += row.chats ?? 0;
          existing.reveals += row.reveals ?? 0;
          existing.spend += row.spend ?? 0;
        } else {
          entityMap.set(key, {
            entityId: row.entity_id,
            entityLevel: row.entity_level,
            visits: row.visits ?? 0,
            chats: row.chats ?? 0,
            reveals: row.reveals ?? 0,
            spend: row.spend ?? 0,
            freshnessState: row.freshness_state as FreshnessState | null,
          });
        }
      }

      return Array.from(entityMap.values()).map((e) => ({
        entityId: e.entityId,
        entityLevel: e.entityLevel,
        chat_rate: e.visits > 0 ? e.chats / e.visits : null,
        cost_per_chat: e.chats > 0 ? e.spend / e.chats : null,
        reveal_rate: e.chats > 0 ? e.reveals / e.chats : null,
        visits: e.visits,
        freshnessState: e.freshnessState,
      }));
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
// Creative Health adapter
// ---------------------------------------------------------------------------

async function fetchHealthInputs(client: SupabaseClient): Promise<AdHealthInput[]> {
  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
  const dateFrom = fourteenDaysAgo.toISOString().slice(0, 10);
  const dateTo = new Date().toISOString().slice(0, 10);

  const { data, error } = await client
    .from('daily_combined_stats')
    .select('entity_id, report_date, spend, chats, visits')
    .gte('report_date', dateFrom)
    .lte('report_date', dateTo)
    .eq('entity_level', 'ad');

  if (error || !data) return [];

  // Fetch ad names and format_category
  const entityIds = [...new Set(data.map((r) => r.entity_id))];
  if (entityIds.length === 0) return [];

  const { data: adsData } = await client
    .from('ads')
    .select('id, name, format_category')
    .in('id', entityIds);

  const adsMap = new Map<string, { name: string | null; format_category: string | null }>();
  if (adsData) {
    for (const ad of adsData) {
      adsMap.set(ad.id, { name: ad.name, format_category: ad.format_category });
    }
  }

  // Aggregate per entity, splitting into first-half / second-half for trend
  const entityMap = new Map<
    string,
    {
      dates: string[];
      totalSpend: number;
      daysWithData: number;
      // Split at midpoint for trend
      recentSpend: number;
      recentChats: number;
      recentVisits: number;
      priorSpend: number;
      priorChats: number;
      priorVisits: number;
    }
  >();

  const midDate = new Date();
  midDate.setDate(midDate.getDate() - 7);
  const midDateStr = midDate.toISOString().slice(0, 10);

  for (const row of data) {
    const existing = entityMap.get(row.entity_id);
    const isRecent = row.report_date >= midDateStr;
    const spend = row.spend ?? 0;
    const chats = row.chats ?? 0;
    const visits = row.visits ?? 0;

    if (existing) {
      existing.dates.push(row.report_date);
      existing.totalSpend += spend;
      existing.daysWithData += 1;
      if (isRecent) {
        existing.recentSpend += spend;
        existing.recentChats += chats;
        existing.recentVisits += visits;
      } else {
        existing.priorSpend += spend;
        existing.priorChats += chats;
        existing.priorVisits += visits;
      }
    } else {
      entityMap.set(row.entity_id, {
        dates: [row.report_date],
        totalSpend: spend,
        daysWithData: 1,
        recentSpend: isRecent ? spend : 0,
        recentChats: isRecent ? chats : 0,
        recentVisits: isRecent ? visits : 0,
        priorSpend: isRecent ? 0 : spend,
        priorChats: isRecent ? 0 : chats,
        priorVisits: isRecent ? 0 : visits,
      });
    }
  }

  return Array.from(entityMap.entries()).map(([entityId, e]) => {
    const adInfo = adsMap.get(entityId);
    const sortedDates = e.dates.sort();
    const recentCPC = e.recentChats > 0 ? e.recentSpend / e.recentChats : null;
    const priorCPC = e.priorChats > 0 ? e.priorSpend / e.priorChats : null;
    const recentChatRate = e.recentVisits > 0 ? e.recentChats / e.recentVisits : null;

    return {
      entityId,
      entityName: adInfo?.name ?? null,
      formatCategory: adInfo?.format_category ?? null,
      firstDate: sortedDates[0],
      lastDate: sortedDates[sortedDates.length - 1],
      totalSpend: e.totalSpend,
      daysWithData: e.daysWithData,
      recentCostPerChat: recentCPC,
      priorCostPerChat: priorCPC,
      recentChatRate,
    };
  });
}

async function persistHealthAlerts(
  client: SupabaseClient,
  scores: AdHealthScore[],
): Promise<number> {
  if (scores.length === 0) return 0;

  const rows = scores.map((s) => ({
    entity_id: s.entityId,
    entity_type: 'ad' as const,
    alert_type: 'health',
    severity: s.health === 'red' ? 'critical' : s.health === 'yellow' ? 'warning' : 'info',
    title: `${s.entityName ?? s.entityId}: ${s.health} health`,
    message: s.reason,
    metadata: {
      health: s.health,
      daysRunning: s.daysRunning,
      totalSpend: s.totalSpend,
      dailySpend: s.dailySpend,
      costPerChat: s.costPerChat,
      costPerChatTrend: s.costPerChatTrend,
      chatRate: s.chatRate,
      formatCategory: s.formatCategory,
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
    console.error('Failed to upsert health alerts:', error.message);
    return 0;
  }
  return rows.length;
}

// ---------------------------------------------------------------------------
// Kill Rules adapter
// ---------------------------------------------------------------------------

async function fetchKillRuleInputs(client: SupabaseClient): Promise<KillRuleInput[]> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const dateFrom = sevenDaysAgo.toISOString().slice(0, 10);
  const dateTo = new Date().toISOString().slice(0, 10);

  const { data, error } = await client
    .from('daily_combined_stats')
    .select('entity_id, spend, impressions, clicks, chats')
    .gte('report_date', dateFrom)
    .lte('report_date', dateTo)
    .eq('entity_level', 'ad');

  if (error || !data) return [];

  // Fetch ad names
  const entityIds = [...new Set(data.map((r) => r.entity_id))];
  if (entityIds.length === 0) return [];

  const { data: adsData } = await client
    .from('ads')
    .select('id, name')
    .in('id', entityIds);

  const nameMap = new Map<string, string | null>();
  if (adsData) {
    for (const ad of adsData) {
      nameMap.set(ad.id, ad.name);
    }
  }

  // Aggregate per entity
  const entityMap = new Map<
    string,
    { spend: number; impressions: number; clicks: number; chats: number }
  >();

  for (const row of data) {
    const existing = entityMap.get(row.entity_id);
    if (existing) {
      existing.spend += row.spend ?? 0;
      existing.impressions += row.impressions ?? 0;
      existing.clicks += row.clicks ?? 0;
      existing.chats += row.chats ?? 0;
    } else {
      entityMap.set(row.entity_id, {
        spend: row.spend ?? 0,
        impressions: row.impressions ?? 0,
        clicks: row.clicks ?? 0,
        chats: row.chats ?? 0,
      });
    }
  }

  return Array.from(entityMap.entries()).map(([entityId, e]) => ({
    entityId,
    entityName: nameMap.get(entityId) ?? null,
    spend: e.spend,
    impressions: e.impressions,
    clicks: e.clicks,
    chats: e.chats,
    ctr: e.impressions > 0 ? (e.clicks / e.impressions) * 100 : null,
    costPerChat: e.chats > 0 ? e.spend / e.chats : null,
    frequency: null,
  }));
}

async function persistKillRuleAlerts(
  client: SupabaseClient,
  violations: Array<import('./kill-rules').KillRuleViolation>,
): Promise<number> {
  if (violations.length === 0) return 0;

  // De-duplicate: keep highest-severity violation per entity
  const perEntity = new Map<string, typeof violations[0]>();
  for (const v of violations) {
    const existing = perEntity.get(v.entityId);
    if (!existing || (v.action === 'kill' && existing.action !== 'kill')) {
      perEntity.set(v.entityId, v);
    }
  }

  const rows = Array.from(perEntity.values()).map((v) => ({
    entity_id: v.entityId,
    entity_type: 'ad' as const,
    alert_type: 'kill_rule',
    severity: v.action === 'kill' ? 'critical' : 'warning',
    title: `${v.entityName ?? v.entityId}: ${v.rule}`,
    message: v.message,
    metadata: {
      rule: v.rule,
      action: v.action,
      metric: v.metric,
      value: v.value,
      threshold: v.threshold,
      spend: v.spend,
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
    console.error('Failed to upsert kill rule alerts:', error.message);
    return 0;
  }
  return rows.length;
}

// ---------------------------------------------------------------------------
// Main Runner
// ---------------------------------------------------------------------------

/**
 * Run all 6 intelligence modules against the current data.
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
  let healthScoreCount = 0;
  let killRuleCount = 0;

  const today = new Date().toISOString().slice(0, 10);

  // Run all 6 modules in parallel — each has its own error handling
  // and DB queries, so one failing does not block the others.
  const results = await Promise.allSettled([
    // 1. Anomaly detection
    (async () => {
      const t0 = Date.now();
      const persistence = createAnomalyPersistence(client);
      const result = await detectAnomalies(persistence, { referenceDate: today });
      console.log(
        `[intelligence] Anomaly detection: ${result.anomalies.length} anomalies across ${result.entitiesChecked} entities (${Date.now() - t0}ms)`,
      );
      return { module: 'anomaly', count: result.anomalies.length } as const;
    })(),
    // 2. Tier classification
    (async () => {
      const t0 = Date.now();
      const persistence = createTierPersistence(client);
      const result = await runTierClassification(persistence);
      console.log(
        `[intelligence] Tier classification: ${result.classified} classified, ${result.suppressed} suppressed (${Date.now() - t0}ms)`,
      );
      return { module: 'tier', count: result.classified } as const;
    })(),
    // 3. Mismatch detection
    (async () => {
      const t0 = Date.now();
      const persistence = createMismatchPersistence(client);
      const result = await detectMismatches(persistence);
      console.log(
        `[intelligence] Mismatch detection: ${result.mismatches.length} mismatches across ${result.entitiesChecked} entities (${Date.now() - t0}ms)`,
      );
      return { module: 'mismatch', count: result.mismatches.length } as const;
    })(),
    // 4. Budget recommendations
    (async () => {
      const t0 = Date.now();
      const persistence = createBudgetPersistence(client);
      // Budget persistence fetches 7 days of data — numDays must match
      const result = await generateBudgetRecommendations(persistence, undefined, 7);
      console.log(
        `[intelligence] Budget advisor: ${result.recommendations.length} recommendations, $${result.suggestedReallocation.toFixed(2)} reallocation (${Date.now() - t0}ms)`,
      );
      return { module: 'budget', count: result.recommendations.length } as const;
    })(),
    // 5. Creative health scoring
    (async () => {
      const t0 = Date.now();
      const inputs = await fetchHealthInputs(client);
      const scores: AdHealthScore[] = inputs.map((input) => scoreAdHealth(input));
      const count = await persistHealthAlerts(client, scores);
      console.log(
        `[intelligence] Creative health: ${count} scores persisted from ${inputs.length} ads (${Date.now() - t0}ms)`,
      );
      return { module: 'health', count } as const;
    })(),
    // 6. Kill rules evaluation
    (async () => {
      const t0 = Date.now();
      const inputs = await fetchKillRuleInputs(client);
      const result = evaluateKillRules(inputs);
      const count = await persistKillRuleAlerts(client, result.violations);
      console.log(
        `[intelligence] Kill rules: ${result.adsKilled} killed, ${result.adsWarned} warned out of ${result.adsChecked} ads (${Date.now() - t0}ms)`,
      );
      return { module: 'kill', count } as const;
    })(),
  ]);

  // Collect results from settled promises
  for (const r of results) {
    if (r.status === 'rejected') {
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
      errors.push(msg);
      console.error('[intelligence] Module failed:', msg);
    } else {
      switch (r.value.module) {
        case 'anomaly': anomalyCount = r.value.count; break;
        case 'tier': tierCount = r.value.count; break;
        case 'mismatch': mismatchCount = r.value.count; break;
        case 'budget': budgetRecCount = r.value.count; break;
        case 'health': healthScoreCount = r.value.count; break;
        case 'kill': killRuleCount = r.value.count; break;
      }
    }
  }

  const durationMs = Date.now() - start;
  console.log(
    `[intelligence] Pass complete in ${durationMs}ms — anomalies:${anomalyCount} tiers:${tierCount} mismatches:${mismatchCount} budgetRecs:${budgetRecCount} healthScores:${healthScoreCount} killRules:${killRuleCount}${errors.length > 0 ? ` errors:${errors.length}` : ''}`,
  );

  return {
    anomalies: anomalyCount,
    tiers: tierCount,
    mismatches: mismatchCount,
    budgetRecs: budgetRecCount,
    healthScores: healthScoreCount,
    killRules: killRuleCount,
    errors,
    durationMs,
  };
}
