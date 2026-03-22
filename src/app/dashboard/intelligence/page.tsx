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
import { type FreshnessState } from '@/lib/sync/freshness';
import { ImageLightbox } from '@/components/image-lightbox';
import { SectionCallout } from '@/components/section-callout';
import { Badge } from '@/components/badge';

// ---------------------------------------------------------------------------
// Types for display
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

// ---------------------------------------------------------------------------
// Data Fetching
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
// Budget Data Fetching
// ---------------------------------------------------------------------------

async function fetchBudgetRecommendations(suppressed: boolean): Promise<BudgetResult | null> {
  if (suppressed) return null;

  const supabase = createServiceClient();

  const persistence: BudgetPersistence = {
    async fetchEntitiesWithSpend(): Promise<BudgetEntityInput[]> {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const dateFrom = sevenDaysAgo.toISOString().slice(0, 10);
      const dateTo = new Date().toISOString().slice(0, 10);

      const { data, error } = await supabase
        .from('daily_combined_stats')
        .select('entity_id, entity_level, spend, visits, chats, reveals, click_throughs, chat_rate, cost_per_chat, reveal_rate, freshness_state')
        .gte('report_date', dateFrom)
        .lte('report_date', dateTo)
        .eq('entity_level', 'ad');

      if (error || !data) return [];

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

  try {
    const result = await generateBudgetRecommendations(persistence);

    // Resolve ad names
    const entityIds = result.recommendations.map((r) => r.entityId);
    if (entityIds.length > 0) {
      const { data: ads } = await supabase
        .from('ads')
        .select('id, name')
        .in('id', entityIds);

      const nameMap = new Map<string, string>();
      for (const ad of ads ?? []) {
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
    }

    return result;
  } catch (err) {
    console.error('Budget recommendations fetch error:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Mismatch Data Fetching
// ---------------------------------------------------------------------------

async function fetchMismatchResults(suppressed: boolean): Promise<(MismatchResult & { entityNames: Record<string, string> }) | null> {
  if (suppressed) return null;

  const supabase = createServiceClient();

  const persistence: MismatchPersistence = {
    async fetchEntitiesForMismatch(): Promise<MismatchEntityInput[]> {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const dateFrom = sevenDaysAgo.toISOString().slice(0, 10);
      const dateTo = new Date().toISOString().slice(0, 10);

      const { data, error } = await supabase
        .from('daily_combined_stats')
        .select('entity_id, entity_level, visits, chat_rate, reveal_rate, reveal_click_through_rate')
        .gte('report_date', dateFrom)
        .lte('report_date', dateTo)
        .eq('entity_level', 'ad');

      if (error || !data) return [];

      // Aggregate by entity (sum visits, use latest rates)
      const entityMap = new Map<string, MismatchEntityInput>();
      for (const row of data) {
        const key = `${row.entity_id}:${row.entity_level}`;
        const existing = entityMap.get(key);
        if (existing) {
          existing.visits += row.visits ?? 0;
          // Keep latest non-null rates (rows are ordered by date)
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

    // Resolve ad names
    const entityIds = result.mismatches.map((m) => m.entityId);
    const entityNames: Record<string, string> = {};
    if (entityIds.length > 0) {
      const { data: ads } = await supabase
        .from('ads')
        .select('id, name')
        .in('id', entityIds);

      for (const ad of ads ?? []) {
        entityNames[ad.id] = ad.name;
      }
    }

    return { ...result, entityNames };
  } catch (err) {
    console.error('Mismatch detection fetch error:', err);
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

  // Fetch budget recommendations and mismatch results (suppressed when alerts are suppressed)
  const [budgetResult, mismatchResult] = await Promise.all([
    fetchBudgetRecommendations(suppressed),
    fetchMismatchResults(suppressed),
  ]);

  return (
    <section className="intelligence-page">
      <h1>Intelligence Board</h1>

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
