/**
 * Intelligence Dashboard — /dashboard/intelligence
 *
 * Full intelligence board showing:
 * - Active threshold alerts with tier badges and explanations
 * - Anomaly alerts with concrete values
 * - Budget recommendations (pause/scale candidates)
 * - Mismatch warnings
 *
 * All surfaces are suppressed in degraded/stale mode.
 *
 * Performance: Uses shared data fetching — one query for daily_combined_stats
 * and one query for ads, then passes pre-fetched data to all analyzers.
 * This eliminates 5 redundant Supabase queries per page load.
 */

export const dynamic = 'force-dynamic';

import { createServiceClient } from '@/lib/supabase/service';
import {
  generateBudgetRecommendations,
  type BudgetResult,
  type BudgetRecommendation,
  type BudgetPersistence,
  type BudgetEntityInput,
} from '@/lib/intelligence/budget-advisor';
import {
  detectMismatches,
  type Mismatch,
  type MismatchResult,
  type MismatchPersistence,
  type MismatchEntityInput,
} from '@/lib/intelligence/mismatch-detector';
import {
  scoreAdHealth,
  analyzeFormatDiversity,
  type AdHealthScore,
  type AdHealthInput,
  type FormatDiversityResult,
} from '@/lib/intelligence/creative-health';
import {
  evaluateKillRules,
  KILL_RULE_THRESHOLDS,
  type KillRuleResult,
  type KillRuleInput,
  type KillRuleViolation,
} from '@/lib/intelligence/kill-rules';
import { type FreshnessState } from '@/lib/sync/freshness';
import { FORMAT_LABELS, type FormatCategory } from '@/lib/creative-attributes';
import { ImageLightbox } from '@/components/image-lightbox';
import { SectionCallout } from '@/components/section-callout';
import { Badge } from '@/components/badge';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AlertRow {
  id: string;
  entity_type: string;
  entity_id: string;
  alert_type: string;
  severity: string;
  message: string;
  data: Record<string, unknown>;
  created_at: string;
}

/** Row type for the unified combined stats query */
interface CombinedStatsRow {
  entity_id: string;
  entity_level: 'campaign' | 'ad' | 'adset';
  report_date: string;
  spend: number | null;
  visits: number | null;
  chats: number | null;
  reveals: number | null;
  click_throughs: number | null;
  impressions: number | null;
  clicks: number | null;
  chat_rate: number | null;
  cost_per_chat: number | null;
  reveal_rate: number | null;
  reveal_click_through_rate: number | null;
  freshness_state: string | null;
}

/** Row type for the unified ads query */
interface AdRow {
  id: string;
  name: string;
  format_category: string | null;
  status: string | null;
  effective_status: string | null;
}

// ---------------------------------------------------------------------------
// Data Fetching — Alerts (independent, queries its own tables)
// ---------------------------------------------------------------------------

async function fetchAlerts(): Promise<{
  thresholdAlerts: AlertRow[];
  anomalyAlerts: AlertRow[];
  dataQualityAlerts: AlertRow[];
  suppressed: boolean;
  suppressionReason: string | null;
}> {
  const supabase = createServiceClient();

  // Check freshness
  const { data: syncLogs } = await supabase
    .from('sync_logs')
    .select('source, status, completed_at')
    .eq('status', 'success')
    .order('completed_at', { ascending: false })
    .limit(10);

  const metaSuccess = syncLogs?.find((l) => l.source === 'meta');
  const ghstlySuccess = syncLogs?.find((l) => l.source === 'ghstly');

  if (!metaSuccess && !ghstlySuccess) {
    return {
      thresholdAlerts: [],
      anomalyAlerts: [],
      dataQualityAlerts: [],
      suppressed: true,
      suppressionReason: 'Data is stale — no successful syncs found. Intelligence surfaces are suppressed.',
    };
  }

  if (!metaSuccess || !ghstlySuccess) {
    return {
      thresholdAlerts: [],
      anomalyAlerts: [],
      dataQualityAlerts: [],
      suppressed: true,
      suppressionReason: `Data is degraded — ${!metaSuccess ? 'Meta' : 'Ghstly'} sync missing. Cross-source intelligence suppressed.`,
    };
  }

  // Fetch recent alerts
  const { data: alerts, error } = await supabase
    .from('intelligence_alerts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error || !alerts) {
    console.error('Intelligence alerts fetch error:', error);
    return {
      thresholdAlerts: [],
      anomalyAlerts: [],
      dataQualityAlerts: [],
      suppressed: false,
      suppressionReason: null,
    };
  }

  return {
    thresholdAlerts: alerts.filter((a: AlertRow) => a.alert_type === 'threshold'),
    anomalyAlerts: alerts.filter((a: AlertRow) => a.alert_type === 'anomaly'),
    dataQualityAlerts: alerts.filter((a: AlertRow) => a.alert_type === 'data_quality'),
    suppressed: false,
    suppressionReason: null,
  };
}

// ---------------------------------------------------------------------------
// Shared Data Fetching — single query for daily_combined_stats and ads
// Eliminates 3 redundant daily_combined_stats queries + 3 redundant ads queries
// ---------------------------------------------------------------------------

/**
 * Single query for daily_combined_stats — replaces 3 separate identical queries.
 * Fetches ALL columns needed by budget, mismatch, creative health, and kill-rule analyzers.
 * Uses 14-day window (creative health needs 14d; others filter to 7d in-memory).
 */
async function fetchCombinedStatsOnce(
  supabase: ReturnType<typeof createServiceClient>,
): Promise<CombinedStatsRow[]> {
  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
  const dateFrom = fourteenDaysAgo.toISOString().slice(0, 10);
  const dateTo = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('daily_combined_stats')
    .select('entity_id, entity_level, report_date, spend, visits, chats, reveals, click_throughs, impressions, clicks, chat_rate, cost_per_chat, reveal_rate, reveal_click_through_rate, freshness_state')
    .gte('report_date', dateFrom)
    .lte('report_date', dateTo)
    .eq('entity_level', 'ad')
    .order('report_date', { ascending: true });

  if (error) {
    console.error('Combined stats fetch error:', error);
    return [];
  }

  return (data ?? []) as CombinedStatsRow[];
}

/**
 * Single query for ads table — replaces 4 separate queries.
 * Fetches ALL columns needed by all analyzers.
 * Only fetches ACTIVE and PAUSED ads to prevent unbounded growth (Fix 3).
 */
async function fetchAllAdsOnce(
  supabase: ReturnType<typeof createServiceClient>,
): Promise<AdRow[]> {
  const { data, error } = await supabase
    .from('ads')
    .select('id, name, format_category, status, effective_status')
    .in('effective_status', ['ACTIVE', 'PAUSED']);

  if (error) {
    console.error('Ads fetch error:', error);
    return [];
  }

  return (data ?? []) as AdRow[];
}

// ---------------------------------------------------------------------------
// Analysis Functions — pure computation on pre-fetched data, no Supabase calls
// ---------------------------------------------------------------------------

/** Filter combined stats to the 7-day window used by budget, mismatch, and kill-rule analyzers. */
function filterToSevenDays(stats: CombinedStatsRow[]): CombinedStatsRow[] {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const dateFrom = sevenDaysAgo.toISOString().slice(0, 10);
  return stats.filter((row) => row.report_date >= dateFrom);
}

async function analyzeBudget(
  combinedStats: CombinedStatsRow[],
  allAds: AdRow[],
): Promise<BudgetResult | null> {
  const sevenDayStats = filterToSevenDays(combinedStats);

  const persistence: BudgetPersistence = {
    async fetchEntitiesWithSpend(): Promise<BudgetEntityInput[]> {
      const entityMap = new Map<string, BudgetEntityInput>();
      for (const row of sevenDayStats) {
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

  try {
    const result = await generateBudgetRecommendations(persistence);

    // Resolve ad names from shared ads data
    const nameMap = new Map<string, string>();
    for (const ad of allAds) {
      nameMap.set(ad.id, ad.name);
    }
    for (const rec of result.recommendations) {
      (rec as unknown as Record<string, unknown>).entityName = nameMap.get(rec.entityId) ?? null;
    }
    for (const rec of result.pauseCandidates) {
      (rec as unknown as Record<string, unknown>).entityName = nameMap.get(rec.entityId) ?? null;
    }
    for (const rec of result.scaleCandidates) {
      (rec as unknown as Record<string, unknown>).entityName = nameMap.get(rec.entityId) ?? null;
    }
    return result;
  } catch (err) {
    console.error('Budget recommendations analysis error:', err);
    return null;
  }
}

async function analyzeMismatches(
  combinedStats: CombinedStatsRow[],
  allAds: AdRow[],
): Promise<(MismatchResult & { entityNames: Record<string, string> }) | null> {
  const sevenDayStats = filterToSevenDays(combinedStats);

  const persistence: MismatchPersistence = {
    async fetchEntitiesForMismatch(): Promise<MismatchEntityInput[]> {
      const entityMap = new Map<string, MismatchEntityInput>();
      for (const row of sevenDayStats) {
        const key = `${row.entity_id}:${row.entity_level}`;
        const existing = entityMap.get(key);
        if (existing) {
          existing.visits += row.visits ?? 0;
          if (row.chat_rate !== null) existing.chat_rate = row.chat_rate;
          if (row.reveal_rate !== null) existing.reveal_rate = row.reveal_rate;
          if (row.reveal_click_through_rate !== null) existing.reveal_click_through_rate = row.reveal_click_through_rate;
        } else {
          entityMap.set(key, {
            entityId: row.entity_id,
            entityLevel: row.entity_level,
            visits: row.visits ?? 0,
            chat_rate: row.chat_rate,
            reveal_rate: row.reveal_rate,
            reveal_click_through_rate: row.reveal_click_through_rate,
          });
        }
      }
      return Array.from(entityMap.values());
    },
  };

  try {
    const result = await detectMismatches(persistence);

    // Resolve ad names from shared ads data
    const nameMap = new Map<string, string>();
    for (const ad of allAds) {
      nameMap.set(ad.id, ad.name);
    }
    const entityNames: Record<string, string> = {};
    for (const m of result.mismatches) {
      const name = nameMap.get(m.entityId);
      if (name) entityNames[m.entityId] = name;
    }
    return { ...result, entityNames };
  } catch (err) {
    console.error('Mismatch detection analysis error:', err);
    return null;
  }
}

function analyzeCreativeHealth(
  combinedStats: CombinedStatsRow[],
  allAds: AdRow[],
): { healthScores: AdHealthScore[]; diversity: FormatDiversityResult } | null {
  if (allAds.length === 0) return null;

  // Build name/format lookup
  const adMap = new Map<string, { name: string; format_category: string | null }>();
  for (const ad of allAds) {
    adMap.set(ad.id, { name: ad.name, format_category: ad.format_category });
  }

  // Group stats by entity_id (uses full 14-day window)
  const entityStats = new Map<string, CombinedStatsRow[]>();
  for (const row of combinedStats) {
    const existing = entityStats.get(row.entity_id) ?? [];
    existing.push(row);
    entityStats.set(row.entity_id, existing);
  }

  // Score each ad that has stats
  const healthScores: AdHealthScore[] = [];
  for (const [entityId, rows] of entityStats) {
    if (rows.length === 0) continue;

    const adInfo = adMap.get(entityId);
    const totalSpend = rows.reduce((sum, r) => sum + (Number(r.spend) || 0), 0);

    // Split into recent half and prior half for trend
    const midpoint = Math.floor(rows.length / 2);
    const priorRows = rows.slice(0, midpoint);
    const recentRows = rows.slice(midpoint);

    const avgMetric = (arr: typeof rows, field: 'cost_per_chat' | 'chat_rate') => {
      const vals = arr.map(r => Number(r[field])).filter(v => !isNaN(v) && v > 0);
      return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
    };

    const input: AdHealthInput = {
      entityId,
      entityName: adInfo?.name ?? null,
      formatCategory: adInfo?.format_category ?? null,
      firstDate: rows[0].report_date,
      lastDate: rows[rows.length - 1].report_date,
      totalSpend,
      daysWithData: rows.length,
      recentCostPerChat: avgMetric(recentRows, 'cost_per_chat'),
      priorCostPerChat: avgMetric(priorRows, 'cost_per_chat'),
      recentChatRate: avgMetric(recentRows, 'chat_rate'),
    };

    healthScores.push(scoreAdHealth(input));
  }

  // Sort: red first, then yellow, then green; within each group by spend desc
  const healthOrder = { red: 0, yellow: 1, green: 2 };
  healthScores.sort((a, b) => {
    const orderDiff = healthOrder[a.health] - healthOrder[b.health];
    if (orderDiff !== 0) return orderDiff;
    return b.totalSpend - a.totalSpend;
  });

  // Format diversity (only ads with recent stats = "active")
  const activeAdIds = new Set(entityStats.keys());
  const activeAds = allAds
    .filter(ad => activeAdIds.has(ad.id))
    .map(ad => ({ format_category: ad.format_category }));

  const diversity = analyzeFormatDiversity(activeAds);

  return { healthScores, diversity };
}

function analyzeKillRules(
  combinedStats: CombinedStatsRow[],
  allAds: AdRow[],
): (KillRuleResult & { adNames: Record<string, string> }) | null {
  const sevenDayStats = filterToSevenDays(combinedStats);

  // Aggregate per entity
  const entityMap = new Map<string, { spend: number; impressions: number; clicks: number; chats: number }>();
  for (const row of sevenDayStats) {
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

  // Resolve ad names from shared ads data
  const adNames: Record<string, string> = {};
  for (const ad of allAds) {
    adNames[ad.id] = ad.name;
  }

  // Build KillRuleInput array
  const inputs: KillRuleInput[] = Array.from(entityMap.entries()).map(([entityId, agg]) => ({
    entityId,
    entityName: adNames[entityId] ?? null,
    spend: agg.spend,
    impressions: agg.impressions,
    clicks: agg.clicks,
    chats: agg.chats,
    ctr: agg.impressions > 0 ? (agg.clicks / agg.impressions) * 100 : null,
    costPerChat: agg.chats > 0 ? agg.spend / agg.chats : null,
    frequency: null,
  }));

  try {
    const result = evaluateKillRules(inputs);
    return { ...result, adNames };
  } catch (err) {
    console.error('Kill rules evaluation error:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helper Components
// ---------------------------------------------------------------------------

function IntelligenceTierBadge({ data }: { data: Record<string, unknown> }) {
  const tier = (data.compositeTier as string) ?? 'Unknown';
  const color = (data.compositeColor as string) ?? 'gray';
  return (
    <Badge
      variant="tier"
      tier={tier as import('@/lib/intelligence/tier-classifier').TierLabel}
      color={color as import('@/lib/intelligence/tier-classifier').TierColor}
    />
  );
}

function AlertCard({ alert }: { alert: AlertRow }) {
  return (
    <div className={`alert-card alert-${alert.severity}`}>
      <div className="alert-header">
        <Badge variant="severity" severity={alert.severity} />
        <span className="alert-entity">
          {alert.entity_type} {alert.entity_id}
        </span>
        {alert.alert_type === 'threshold' && <IntelligenceTierBadge data={alert.data} />}
      </div>
      <p className="alert-message">{alert.message}</p>
      <time className="alert-time">
        {new Date(alert.created_at).toLocaleString('en-US', {
          timeZone: 'America/Los_Angeles',
        })}
      </time>
    </div>
  );
}

function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p>{message}</p>
    </div>
  );
}


function BudgetRecCard({ rec }: { rec: BudgetRecommendation & { entityName?: string | null } }) {
  const actionLabel =
    rec.action === 'pause' ? 'Pause and reallocate' :
    rec.action === 'reduce' ? 'Reduce spend' :
    rec.action === 'scale' ? 'Increase budget' :
    rec.action === 'increase' ? 'Increase budget' :
    'Maintain';

  return (
    <div className={`budget-rec-card budget-rec-${rec.action}`}>
      <div className="budget-rec-header">
        <ImageLightbox adId={rec.entityId} size="md" />
        <Badge variant="action" action={rec.action} />
        <Badge
          variant="tier"
          tier={rec.tier.compositeTier as import('@/lib/intelligence/tier-classifier').TierLabel}
          color={rec.tier.compositeColor as import('@/lib/intelligence/tier-classifier').TierColor}
        />
      </div>
      <div className="budget-rec-entity">
        <span className="budget-rec-id" title={rec.entityId}>
          {rec.entityName || rec.entityId}
        </span>
        <span className="budget-rec-level">{rec.entityLevel}</span>
      </div>
      <div className="budget-rec-spend">
        <span className="budget-rec-current">
          ${rec.currentSpend.toFixed(2)}/day
        </span>
        {rec.suggestedSpend !== null && (
          <span className="budget-rec-arrow">
            {' → '}
            <strong>${rec.suggestedSpend.toFixed(2)}/day</strong>
          </span>
        )}
      </div>
      <p className="budget-rec-action">{actionLabel}</p>
      <p className="budget-rec-rationale">{rec.rationale}</p>
    </div>
  );
}


function MismatchMetricDisplay({ metric }: { metric: Mismatch['metrics'][number] }) {
  const arrow = metric.assessment === 'high' ? '\u2191' : '\u2193';
  return (
    <span className="mismatch-metric">
      <span className="mismatch-metric-label">{metric.label}:</span>
      <span className="mismatch-metric-value">{(metric.value * 100).toFixed(1)}%</span>
      <span className={`mismatch-metric-arrow assessment-${metric.assessment}`}>{arrow}</span>
    </span>
  );
}

function MismatchCard({ mismatch, entityName }: { mismatch: Mismatch; entityName: string | null }) {
  return (
    <div className={`mismatch-card mismatch-${mismatch.pattern}`}>
      <div className="mismatch-header">
        <ImageLightbox adId={mismatch.entityId} size="md" />
        <Badge variant="mismatch-pattern" pattern={mismatch.pattern} />
      </div>
      <div className="mismatch-entity">
        <span className="mismatch-entity-name" title={mismatch.entityId}>
          {entityName || mismatch.entityId}
        </span>
        <span className="mismatch-entity-level">{mismatch.entityLevel}</span>
      </div>
      <div className="mismatch-metrics">
        {mismatch.metrics.map((m) => (
          <MismatchMetricDisplay key={m.name} metric={m} />
        ))}
      </div>
      <p className="mismatch-message">{mismatch.message}</p>
      <p className="mismatch-recommendation">{mismatch.recommendation}</p>
    </div>
  );
}

function MismatchSection({ result }: { result: MismatchResult & { entityNames: Record<string, string> } }) {
  return (
    <div className="intelligence-section mismatch-section">
      <div className="mismatch-section-header">
        <h2>Creative-Funnel Mismatches</h2>
        {result.mismatches.length > 0 && (
          <span className="budget-count">{result.mismatches.length}</span>
        )}
      </div>
      <SectionCallout>
        <p>Detects ads where <strong>creative performance doesn't match funnel performance</strong>:</p>
        <ul>
          <li><strong>CLICK &gt; CHAT</strong> (orange) — High click-through rate (50%+) but low chat rate (&lt;50%). The creative attracts clicks but the chat greeting or landing page fails. Fix: A/B test chat entry experience.</li>
          <li><strong>CHAT &gt; REVEAL</strong> (yellow) — High chat rate (70%+) but low reveal rate (&lt;25%). Chat is engaging but the reveal prompt is weak. Fix: adjust AI persona reveal timing.</li>
        </ul>
        <p>Requires 50+ visits per ad in the 7-day window.</p>
      </SectionCallout>
      <p className="mismatch-checked-note">
        {result.entitiesChecked} ads checked, {result.entitiesFlagged} flagged
      </p>
      {result.mismatches.length === 0 ? (
        <EmptyState
          title="No creative-funnel mismatches detected"
          message="Metrics are balanced across all ads."
        />
      ) : (
        <div className="mismatch-grid">
          {result.mismatches.map((mismatch, idx) => (
            <MismatchCard
              key={`${mismatch.entityId}-${mismatch.pattern}-${idx}`}
              mismatch={mismatch}
              entityName={result.entityNames[mismatch.entityId] ?? null}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BudgetRecommendationsSection({ budget }: { budget: BudgetResult }) {
  const { pauseCandidates, scaleCandidates, suggestedReallocation, totalCurrentSpend } = budget;

  if (pauseCandidates.length === 0 && scaleCandidates.length === 0) {
    return (
      <div className="intelligence-section">
        <h2>Budget Recommendations</h2>
        <EmptyState
          title="No budget actions needed"
          message="All ads are performing within acceptable ranges relative to their spend."
        />
      </div>
    );
  }

  return (
    <div className="intelligence-section">
      <h2>Budget Recommendations</h2>
      <SectionCallout>
        <p>Identifies ads to <strong>kill/reduce</strong> and ads to <strong>scale</strong> based on performance tiers and spend:</p>
        <ul>
          <li><strong>Kill List</strong> — Ads rated Poor/Critical spending &gt;$1/day. Pause to stop wasting budget, or reduce by 50%.</li>
          <li><strong>Scale List</strong> — Ads rated Perfect/Really Good spending below median. Increase budget to get more chats at a similar cost.</li>
        </ul>
        <p>Each card shows the specific metrics driving the recommendation, the dollar impact, and actionable advice. All recommendations are <strong>advisory only</strong> — nothing is changed in Meta automatically.</p>
      </SectionCallout>

      {totalCurrentSpend > 0 && (
        <div className="budget-summary">
          <span className="budget-summary-item">
            Total daily spend: <strong>${totalCurrentSpend.toFixed(2)}</strong>
          </span>
          {suggestedReallocation > 0 && (
            <span className="budget-summary-item budget-summary-savings">
              Potential savings: <strong>${suggestedReallocation.toFixed(2)}/day</strong>
            </span>
          )}
        </div>
      )}

      {/* Kill List — ads to pause/reduce */}
      {pauseCandidates.length > 0 && (
        <div className="budget-subsection">
          <h3 className="budget-subsection-title budget-kill-title">
            Kill List
            <span className="budget-count">{pauseCandidates.length}</span>
          </h3>
          <p className="budget-subsection-desc">
            Ads rated Poor/Critical with active spend. Pause or reduce to free up ${suggestedReallocation.toFixed(2)}/day.
          </p>
          <div className="budget-rec-grid">
            {pauseCandidates.map((rec) => (
              <BudgetRecCard key={rec.entityId} rec={rec} />
            ))}
          </div>
        </div>
      )}

      {/* Scale List — ads to increase */}
      {scaleCandidates.length > 0 && (
        <div className="budget-subsection">
          <h3 className="budget-subsection-title budget-scale-title">
            Scale List
            <span className="budget-count">{scaleCandidates.length}</span>
          </h3>
          <p className="budget-subsection-desc">
            Ads rated Perfect/Very Good with room to scale. Reallocate freed budget here.
          </p>
          <div className="budget-rec-grid">
            {scaleCandidates.map((rec) => (
              <BudgetRecCard key={rec.entityId} rec={rec} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Kill Rules Section Component
// ---------------------------------------------------------------------------

function KillRuleActionBadge({ action }: { action: 'kill' | 'warn' }) {
  const styles = action === 'kill'
    ? { bg: '#3d0a0a', border: '#dc2626', text: '#f87171', label: 'KILL' }
    : { bg: '#3d2e05', border: '#ca8a04', text: '#facc15', label: 'WARN' };
  return (
    <span style={{ background: styles.bg, border: `1px solid ${styles.border}`, borderRadius: '4px', padding: '0.15rem 0.4rem', fontSize: '0.7rem', color: styles.text, fontWeight: 600, textTransform: 'uppercase' as const }}>
      {styles.label}
    </span>
  );
}

function KillRuleCard({ violation }: { violation: KillRuleViolation }) {
  const borderColor = violation.action === 'kill' ? '#dc2626' : '#ca8a04';
  const messageColor = violation.action === 'kill' ? '#f87171' : '#facc15';

  return (
    <div style={{ background: 'var(--color-surface-2, #1a1a2e)', border: `1px solid ${borderColor}`, borderRadius: '6px', padding: '0.75rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <ImageLightbox adId={violation.entityId} size="sm" />
          <span style={{ fontSize: '0.8rem', color: 'var(--color-text-primary, #e0e0e0)', fontWeight: 500 }} title={violation.entityId}>
            {violation.entityName ?? violation.entityId}
          </span>
        </div>
        <KillRuleActionBadge action={violation.action} />
      </div>
      <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.75rem', color: 'var(--color-text-secondary, #a0a0b0)', marginBottom: '0.25rem' }}>
        <span>Rule: <strong style={{ color: '#e0e0e0' }}>{violation.rule}</strong></span>
        <span>{violation.metric}: <strong style={{ color: messageColor }}>{violation.metric === 'ctr' ? `${violation.value.toFixed(2)}%` : violation.metric === 'chats' ? String(violation.value) : `$${violation.value.toFixed(2)}`}</strong></span>
        <span>Threshold: {violation.metric === 'ctr' ? `${violation.threshold}%` : violation.metric === 'chats' ? String(violation.threshold) : `$${violation.threshold.toFixed(2)}`}</span>
        <span>Spend: ${violation.spend.toFixed(2)}</span>
      </div>
      <p style={{ margin: '0.4rem 0 0', fontSize: '0.75rem', color: messageColor }}>
        {violation.message}
      </p>
    </div>
  );
}

function KillRulesSection({ result }: { result: KillRuleResult & { adNames: Record<string, string> } }) {
  return (
    <div className="intelligence-section">
      <h2>
        Kill Rules
        {result.adsKilled > 0 && <span style={{ marginLeft: '0.5rem', background: '#3d0a0a', border: '1px solid #dc2626', borderRadius: '4px', padding: '0.1rem 0.4rem', fontSize: '0.7rem', color: '#f87171' }}>{result.adsKilled} kill</span>}
        {result.adsWarned > 0 && <span style={{ marginLeft: '0.5rem', background: '#3d2e05', border: '1px solid #ca8a04', borderRadius: '4px', padding: '0.1rem 0.4rem', fontSize: '0.7rem', color: '#facc15' }}>{result.adsWarned} warn</span>}
      </h2>
      <SectionCallout>
        <p>Binary <strong>circuit breakers</strong> that flag ads for immediate action based on hard spend/performance thresholds. Unlike tier classification (which grades on a spectrum), kill rules are non-negotiable cutoffs.</p>
        <ul>
          <li><strong>KILL</strong> (red) — Stop this ad immediately. No second chances.</li>
          <li><strong>WARN</strong> (yellow) — Monitor for 24h. Kill if it doesn't improve.</li>
        </ul>
        <p>Rules: CTR &lt; {KILL_RULE_THRESHOLDS.low_ctr.threshold}% after ${KILL_RULE_THRESHOLDS.low_ctr.minSpend} = kill | CPA &gt; ${KILL_RULE_THRESHOLDS.high_cpa.threshold} after ${KILL_RULE_THRESHOLDS.high_cpa.minSpend} = kill | CPA &gt; ${KILL_RULE_THRESHOLDS.extreme_cpa.threshold} after ${KILL_RULE_THRESHOLDS.extreme_cpa.minSpend} = kill | 0 chats after ${KILL_RULE_THRESHOLDS.no_chats.minSpend} = kill</p>
      </SectionCallout>
      <p style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary, #a0a0b0)', margin: '0.5rem 0' }}>
        {result.adsChecked} ads checked, {result.adsKilled} to kill, {result.adsWarned} to monitor
      </p>
      {result.violations.length === 0 ? (
        <EmptyState
          title="No kill rule violations"
          message="All ads are above minimum thresholds. No immediate action needed."
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '0.75rem' }}>
          {result.violations.map((v, idx) => (
            <KillRuleCard key={`${v.entityId}-${v.rule}-${idx}`} violation={v} />
          ))}
        </div>
      )}
    </div>
  );
}

function HealthBadge({ health }: { health: 'green' | 'yellow' | 'red' }) {
  const colors = {
    green: { bg: '#0d3320', border: '#16a34a', text: '#4ade80', label: 'Healthy' },
    yellow: { bg: '#3d2e05', border: '#ca8a04', text: '#facc15', label: 'Warning' },
    red: { bg: '#3d0a0a', border: '#dc2626', text: '#f87171', label: 'Replace' },
  };
  const c = colors[health];
  return (
    <span style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: '4px', padding: '0.15rem 0.4rem', fontSize: '0.7rem', color: c.text, fontWeight: 600 }}>
      {c.label}
    </span>
  );
}

function CreativeHealthSection({ healthScores, diversity }: { healthScores: AdHealthScore[]; diversity: FormatDiversityResult }) {
  const redCount = healthScores.filter(s => s.health === 'red').length;
  const yellowCount = healthScores.filter(s => s.health === 'yellow').length;
  const greenCount = healthScores.filter(s => s.health === 'green').length;

  return (
    <>
      {/* Format Diversity */}
      <div className="intelligence-section">
        <h2>Format Diversity</h2>
        <SectionCallout>
          <p>Tracks how many <strong>distinct visual formats</strong> are running simultaneously. Running 3+ formats protects against creative fatigue cliffs — when one format dies, others keep performing.</p>
          <p>Formats: Ghost Pin, Find My, Notification, Chat, Dynamic Island, Widget, etc.</p>
        </SectionCallout>
        {diversity.alert && (
          <div className={`suppression-banner ${diversity.distinctFormats <= 1 ? 'alert-critical' : 'alert-warning'}`} style={{ margin: '0.5rem 0', padding: '0.75rem', borderRadius: '6px', background: diversity.distinctFormats <= 1 ? '#3d0a0a' : '#3d2e05', border: `1px solid ${diversity.distinctFormats <= 1 ? '#dc2626' : '#ca8a04'}` }}>
            <p style={{ margin: 0, fontSize: '0.85rem', color: diversity.distinctFormats <= 1 ? '#f87171' : '#facc15' }}>
              {diversity.alert}
            </p>
          </div>
        )}
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', margin: '0.75rem 0' }}>
          <div style={{ background: 'var(--color-surface-2, #1a1a2e)', padding: '0.75rem 1rem', borderRadius: '6px', border: '1px solid var(--color-border, #2a2a3e)', textAlign: 'center' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: diversity.sufficient ? '#4ade80' : '#facc15' }}>{diversity.distinctFormats}</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-secondary, #a0a0b0)' }}>Active Formats</div>
          </div>
          {diversity.activeFormats.map(f => (
            <div key={f.category} style={{ background: 'var(--color-surface-2, #1a1a2e)', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid var(--color-border, #2a2a3e)', fontSize: '0.8rem' }}>
              <span style={{ color: '#2dd4bf' }}>{f.label}</span>
              <span style={{ color: 'var(--color-text-secondary, #a0a0b0)', marginLeft: '0.5rem' }}>{f.count} ad{f.count !== 1 ? 's' : ''}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Ad Health Scores */}
      <div className="intelligence-section">
        <h2>
          Ad Health
          {redCount > 0 && <span style={{ marginLeft: '0.5rem', background: '#3d0a0a', border: '1px solid #dc2626', borderRadius: '4px', padding: '0.1rem 0.4rem', fontSize: '0.7rem', color: '#f87171' }}>{redCount} replace</span>}
          {yellowCount > 0 && <span style={{ marginLeft: '0.5rem', background: '#3d2e05', border: '1px solid #ca8a04', borderRadius: '4px', padding: '0.1rem 0.4rem', fontSize: '0.7rem', color: '#facc15' }}>{yellowCount} warning</span>}
        </h2>
        <SectionCallout>
          <p>Scores each active ad's health based on <strong>age</strong>, <strong>cost/chat trend</strong>, and <strong>performance</strong>.</p>
          <ul>
            <li><strong>Green</strong> — Healthy, performing within targets</li>
            <li><strong>Yellow</strong> — Decaying or poor CPA. Start generating replacement.</li>
            <li><strong>Red</strong> — Fatigued or critical CPA. Kill today, replace immediately.</li>
          </ul>
          <p>Ads running 14+ days with worsening CPA are flagged. Ads running 21+ days with declining chat rate trigger immediate replacement.</p>
        </SectionCallout>
        {healthScores.length === 0 ? (
          <EmptyState title="No ad health data" message="No active ads with recent performance data." />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '0.75rem' }}>
            {healthScores.map(score => (
              <div key={score.entityId} style={{ background: 'var(--color-surface-2, #1a1a2e)', border: `1px solid ${score.health === 'red' ? '#dc2626' : score.health === 'yellow' ? '#ca8a04' : 'var(--color-border, #2a2a3e)'}`, borderRadius: '6px', padding: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <ImageLightbox adId={score.entityId} size="sm" />
                    <span style={{ fontSize: '0.8rem', color: 'var(--color-text-primary, #e0e0e0)', fontWeight: 500 }} title={score.entityId}>
                      {score.entityName ?? score.entityId}
                    </span>
                  </div>
                  <HealthBadge health={score.health} />
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.75rem', color: 'var(--color-text-secondary, #a0a0b0)', marginBottom: '0.25rem' }}>
                  <span>{score.daysRunning}d running</span>
                  <span>${score.dailySpend.toFixed(2)}/day</span>
                  {score.costPerChat !== null && <span>${score.costPerChat.toFixed(2)}/chat</span>}
                  {score.chatRate !== null && <span>{(score.chatRate * 100).toFixed(0)}% chat</span>}
                </div>
                {score.formatCategory && (
                  <span style={{ fontSize: '0.65rem', color: '#2dd4bf', background: 'var(--color-surface-1, #111)', borderRadius: '3px', padding: '0.1rem 0.3rem' }}>
                    {FORMAT_LABELS[score.formatCategory] ?? score.formatCategory}
                  </span>
                )}
                <p style={{ margin: '0.4rem 0 0', fontSize: '0.75rem', color: score.health === 'red' ? '#f87171' : score.health === 'yellow' ? '#facc15' : '#a0a0b0' }}>
                  {score.reason}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function IntelligencePage() {
  const {
    thresholdAlerts,
    anomalyAlerts,
    dataQualityAlerts,
    suppressed,
    suppressionReason,
  } = await fetchAlerts();

  if (suppressed) {
    return (
      <section className="intelligence-page">
        <h1>Intelligence Board</h1>
        <div className="suppression-banner">
          <p>{suppressionReason}</p>
        </div>
      </section>
    );
  }

  // Shared data fetch — one query each for daily_combined_stats and ads
  // (replaces 3 separate daily_combined_stats queries + 4 separate ads queries)
  const supabase = createServiceClient();
  const [combinedStats, allAds] = await Promise.all([
    fetchCombinedStatsOnce(supabase),
    fetchAllAdsOnce(supabase),
  ]);

  // Run all analysis in parallel using pre-fetched data (no more Supabase calls)
  const [budgetResult, mismatchResult, creativeHealth, killRuleResult] = await Promise.all([
    analyzeBudget(combinedStats, allAds),
    analyzeMismatches(combinedStats, allAds),
    Promise.resolve(analyzeCreativeHealth(combinedStats, allAds)),
    Promise.resolve(analyzeKillRules(combinedStats, allAds)),
  ]);

  return (
    <section className="intelligence-page">
      <h1>Intelligence Board</h1>

      {/* Creative Health + Format Diversity — most actionable, shown first */}
      {creativeHealth && (
        <CreativeHealthSection
          healthScores={creativeHealth.healthScores}
          diversity={creativeHealth.diversity}
        />
      )}

      {/* Kill Rules — binary circuit breakers */}
      {killRuleResult && (
        <KillRulesSection result={killRuleResult} />
      )}

      {/* Threshold Tier Alerts */}
      <div className="intelligence-section">
        <h2>Performance Tiers</h2>
        <SectionCallout>
          <p>Every ad is classified into a tier from <strong>Perfect</strong> to <strong>Critical</strong> based on 3 metrics:</p>
          <ul>
            <li><strong>Chat Rate</strong> — % of visitors who start a chat (Perfect = 85%+, Critical = &lt;40%)</li>
            <li><strong>Cost Per Chat</strong> — cost per chat started (Perfect = &le;$0.20, Critical = &gt;$0.60)</li>
            <li><strong>Reveal Rate</strong> — % of chatters who reach the reveal (Perfect = 40%+, Critical = &lt;20%)</li>
          </ul>
          <p>The <strong>worst</strong> metric determines the overall tier. Requires 50+ visits and fresh data.</p>
        </SectionCallout>
        {thresholdAlerts.length === 0 ? (
          <EmptyState
            title="No tier alerts"
            message="All entities are performing within acceptable thresholds."
          />
        ) : (
          <div className="alert-grid">
            {thresholdAlerts.map((alert) => (
              <AlertCard key={alert.id} alert={alert} />
            ))}
          </div>
        )}
      </div>

      {/* Anomaly Alerts */}
      <div className="intelligence-section">
        <h2>Anomalies</h2>
        <SectionCallout>
          <p>Detects <strong>sudden performance changes</strong> by comparing the last 3 days vs the prior 3 days for each ad.</p>
          <p>Flags any metric that swings by more than <strong>15%</strong> — chat rate drops, cost per chat spikes, reveal rate drops, CTR drops, CPC spikes.</p>
          <p>No anomalies = stable performance across all ads. This is good.</p>
        </SectionCallout>
        {anomalyAlerts.length === 0 ? (
          <EmptyState
            title="No anomalies detected"
            message="No significant metric changes detected in the last 3 days."
          />
        ) : (
          <div className="alert-grid">
            {anomalyAlerts.map((alert) => (
              <AlertCard key={alert.id} alert={alert} />
            ))}
          </div>
        )}
      </div>

      {/* Data Quality Alerts */}
      <div className="intelligence-section">
        <h2>Data Quality</h2>
        <SectionCallout>
          <p>Checks <strong>data consistency</strong> between Meta Ads and Ghstly by comparing session counts against daily stats.</p>
          <p>If chats, reveals, or click-throughs diverge by more than <strong>10%</strong>, it flags a reconciliation breach. This catches broken UTM tracking, API sync gaps, or pipeline issues.</p>
          <p>No issues = Meta and Ghstly data agree. Numbers are trustworthy.</p>
        </SectionCallout>
        {dataQualityAlerts.length === 0 ? (
          <EmptyState
            title="No data quality issues"
            message="Reconciliation is healthy across all entities."
          />
        ) : (
          <div className="alert-grid">
            {dataQualityAlerts.map((alert) => (
              <AlertCard key={alert.id} alert={alert} />
            ))}
          </div>
        )}
      </div>

      {/* Creative-Funnel Mismatches */}
      {mismatchResult ? (
        <MismatchSection result={mismatchResult} />
      ) : (
        <div className="intelligence-section mismatch-section">
          <h2>Creative-Funnel Mismatches</h2>
          <EmptyState
            title="No creative-funnel mismatches detected"
            message="Metrics are balanced across all ads."
          />
        </div>
      )}

      {/* Budget Recommendations */}
      {budgetResult && <BudgetRecommendationsSection budget={budgetResult} />}
    </section>
  );
}
