/**
 * /dashboard — Overview Page (Server Component)
 *
 * Fetches all data server-side in parallel via Supabase service client,
 * then passes it as props to presentational components.
 * No client-side fetch waterfalls.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { requireAdminUser } from "@/lib/auth/guards";
import { getDateRanges, isValidPeriod, type DateRange } from "@/lib/date-utils";
import { computeFreshness, type SyncLogRow, type FreshnessState } from "@/lib/sync/freshness";
import {
  generateBudgetRecommendations,
  type BudgetPersistence,
  type BudgetEntityInput,
} from "@/lib/intelligence/budget-advisor";

import { KpiBar, type KpiItem } from "@/components/kpi-bar";
import { ScorecardTable, type AdRow } from "@/components/scorecard-table";
import { OverviewAlerts, type AlertRow } from "@/components/overview-alerts";
import { FreshnessBanner, type FreshnessBannerData } from "@/components/freshness-banner";
import { BudgetSection, type BudgetApiData, type BudgetApiMeta } from "@/components/budget-section";
import { FunnelChart, type FunnelStep } from "@/components/funnel-chart";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// KPI data fetching (mirrors /api/stats/overview logic)
// ---------------------------------------------------------------------------

interface AggregatedKpis {
  spend: number;
  clicks: number;
  impressions: number;
  unique_clicks: number;
  chats: number;
  visits: number;
  reveals: number;
}

async function fetchAggregated(
  supabase: ReturnType<typeof createServiceClient>,
  range: DateRange,
): Promise<AggregatedKpis> {
  const { data, error } = await supabase.rpc("aggregate_kpis", {
    date_from: range.from,
    date_to: range.to,
  });

  if (error) {
    console.error("Overview stats RPC error:", error.message);
    return { spend: 0, clicks: 0, impressions: 0, unique_clicks: 0, chats: 0, visits: 0, reveals: 0 };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return { spend: 0, clicks: 0, impressions: 0, unique_clicks: 0, chats: 0, visits: 0, reveals: 0 };
  }

  return {
    spend: Number(row.spend) || 0,
    clicks: Number(row.clicks) || 0,
    impressions: Number(row.impressions) || 0,
    unique_clicks: Number(row.unique_clicks) || 0,
    chats: Number(row.chats) || 0,
    visits: Number(row.visits) || 0,
    reveals: Number(row.reveals) || 0,
  };
}

function safeDivide(num: number, denom: number): number | null {
  if (denom === 0) return null;
  return num / denom;
}

function computeKpis(agg: AggregatedKpis) {
  return {
    spend: agg.spend,
    cost_per_chat: safeDivide(agg.spend, agg.chats),
    chat_rate: safeDivide(agg.chats, agg.visits),
    reveal_rate: safeDivide(agg.reveals, agg.chats),
    cost_per_unique_click: safeDivide(agg.spend, agg.unique_clicks),
    ctr: safeDivide(agg.clicks, agg.impressions),
  };
}

function computeDelta(current: number | null, comparison: number | null): number | null {
  if (current === null || comparison === null || comparison === 0) return null;
  return ((current - comparison) / comparison) * 100;
}

async function fetchKpiData(
  supabase: ReturnType<typeof createServiceClient>,
  period: string,
): Promise<KpiItem[]> {
  const validPeriod = isValidPeriod(period) ? period : "7d";
  const { current: currentRange, comparison: compRange } = getDateRanges(validPeriod);

  const [currentAgg, compAgg] = await Promise.all([
    fetchAggregated(supabase, currentRange),
    fetchAggregated(supabase, compRange),
  ]);

  const currentKpis = computeKpis(currentAgg);
  const compKpis = computeKpis(compAgg);

  return [
    { metric: "spend", label: "Spend", current: currentKpis.spend, comparison: compKpis.spend, delta_pct: computeDelta(currentKpis.spend, compKpis.spend), format: "currency" },
    { metric: "cost_per_chat", label: "Cost per Chat", current: currentKpis.cost_per_chat, comparison: compKpis.cost_per_chat, delta_pct: computeDelta(currentKpis.cost_per_chat, compKpis.cost_per_chat), format: "currency", invert: true },
    { metric: "chat_rate", label: "Chat Rate", current: currentKpis.chat_rate, comparison: compKpis.chat_rate, delta_pct: computeDelta(currentKpis.chat_rate, compKpis.chat_rate), format: "percent" },
    { metric: "reveal_rate", label: "Reveal Rate", current: currentKpis.reveal_rate, comparison: compKpis.reveal_rate, delta_pct: computeDelta(currentKpis.reveal_rate, compKpis.reveal_rate), format: "percent" },
    { metric: "cost_per_unique_click", label: "Cost/Unique Click", current: currentKpis.cost_per_unique_click, comparison: compKpis.cost_per_unique_click, delta_pct: computeDelta(currentKpis.cost_per_unique_click, compKpis.cost_per_unique_click), format: "currency", invert: true },
    { metric: "ctr", label: "CTR", current: currentKpis.ctr, comparison: compKpis.ctr, delta_pct: computeDelta(currentKpis.ctr, compKpis.ctr), format: "percent" },
  ];
}

// ---------------------------------------------------------------------------
// Scorecard data fetching (mirrors /api/stats/scorecard logic)
// ---------------------------------------------------------------------------

const MIN_CHATS_THRESHOLD = 5;
const SIGNED_URL_EXPIRY = 3600;

async function fetchScorecardData(
  supabase: ReturnType<typeof createServiceClient>,
  period: string,
): Promise<AdRow[]> {
  const validPeriod = isValidPeriod(period) ? period : "7d";
  const { current: range } = getDateRanges(validPeriod);

  const { data: statsData, error: statsError } = await supabase.rpc("aggregate_scorecard", {
    date_from: range.from,
    date_to: range.to,
  });

  if (statsError) {
    console.error("Scorecard RPC error:", statsError.message);
    return [];
  }

  const aggregatedRows = (statsData ?? []) as Array<{
    entity_id: string;
    spend: number;
    chats: number;
    visits: number;
    reveals: number;
    impressions: number;
    clicks: number;
    unique_clicks: number;
    click_throughs: number;
    cost_per_chat: number | null;
    chat_rate: number | null;
    reveal_rate: number | null;
    ctr: number | null;
    cpc: number | null;
  }>;

  // Fetch ad metadata
  const adIds = aggregatedRows.map((r) => r.entity_id);
  const adsMap = new Map<string, { name: string; campaign_id: string; adset_id: string }>();
  const campaignsMap = new Map<string, string>();
  const adsetsMap = new Map<string, string>();

  if (adIds.length > 0) {
    const { data: adsData } = await supabase
      .from("ads")
      .select("id, name, campaign_id, adset_id")
      .in("id", adIds);

    for (const ad of adsData ?? []) {
      adsMap.set(ad.id, { name: ad.name, campaign_id: ad.campaign_id, adset_id: ad.adset_id });
    }

    const campaignIds = [...new Set((adsData ?? []).map((a) => a.campaign_id))];
    const adsetIds = [...new Set((adsData ?? []).map((a) => a.adset_id).filter(Boolean))];

    const [campResult, adsetResult] = await Promise.all([
      campaignIds.length > 0
        ? supabase.from("campaigns").select("id, name").in("id", campaignIds)
        : Promise.resolve({ data: [] }),
      adsetIds.length > 0
        ? supabase.from("adsets").select("id, name").in("id", adsetIds)
        : Promise.resolve({ data: [] }),
    ]);

    for (const c of campResult.data ?? []) {
      campaignsMap.set(c.id, c.name);
    }
    for (const a of adsetResult.data ?? []) {
      adsetsMap.set(a.id, a.name);
    }

    // Fetch thumbnail signed URLs
    const { data: adsWithCreatives } = await supabase
      .from("ads")
      .select("id, creative_storage_path")
      .in("id", adIds)
      .not("creative_storage_path", "is", null);

    const thumbnailPaths = (adsWithCreatives ?? []).filter((a) => a.creative_storage_path);
    let thumbnailMap = new Map<string, string>();

    if (thumbnailPaths.length > 0) {
      const paths = thumbnailPaths.map((a) => a.creative_storage_path!);
      const { data: signedUrls } = await supabase.storage
        .from("ad-creatives")
        .createSignedUrls(paths, SIGNED_URL_EXPIRY);

      const pathToAdId = new Map(thumbnailPaths.map((a) => [a.creative_storage_path, a.id]));
      for (const entry of signedUrls ?? []) {
        if (entry.signedUrl) {
          const adId = pathToAdId.get(entry.path);
          if (adId) thumbnailMap.set(adId, entry.signedUrl);
        }
      }
    }

    // Build rows
    const rows: AdRow[] = aggregatedRows.map((agg) => {
      const adMeta = adsMap.get(agg.entity_id);
      const insufficient = Number(agg.chats) < MIN_CHATS_THRESHOLD;
      const costPerChat = Number(agg.chats) > 0 ? Number(agg.spend) / Number(agg.chats) : null;
      const chatRate = Number(agg.visits) > 0 ? Number(agg.chats) / Number(agg.visits) : null;
      const revealRate = Number(agg.chats) > 0 ? Number(agg.reveals) / Number(agg.chats) : null;

      return {
        entity_id: agg.entity_id,
        ad_name: adMeta?.name ?? agg.entity_id,
        campaign_id: adMeta?.campaign_id ?? "",
        campaign_name: adMeta ? campaignsMap.get(adMeta.campaign_id) ?? adMeta.campaign_id : "",
        adset_id: adMeta?.adset_id ?? "",
        adset_name: adMeta ? adsetsMap.get(adMeta.adset_id) ?? adMeta.adset_id : "",
        spend: Number(agg.spend),
        cost_per_chat: insufficient ? null : costPerChat,
        chat_rate: chatRate,
        reveal_rate: revealRate,
        chats: Number(agg.chats),
        visits: Number(agg.visits),
        reveals: Number(agg.reveals),
        impressions: Number(agg.impressions),
        clicks: Number(agg.clicks),
        unique_clicks: Number(agg.unique_clicks),
        insufficient_data: insufficient,
        thumbnail_url: thumbnailMap.get(agg.entity_id),
      };
    });

    // Sort: insufficient-data rows go last, then by cost_per_chat ascending
    rows.sort((a, b) => {
      if (a.insufficient_data && !b.insufficient_data) return 1;
      if (!a.insufficient_data && b.insufficient_data) return -1;
      if (a.cost_per_chat === null && b.cost_per_chat === null) return 0;
      if (a.cost_per_chat === null) return 1;
      if (b.cost_per_chat === null) return -1;
      return a.cost_per_chat - b.cost_per_chat;
    });

    return rows;
  }

  return [];
}

// ---------------------------------------------------------------------------
// Alerts data fetching (mirrors /api/intelligence/alerts logic)
// ---------------------------------------------------------------------------

async function fetchAlerts(
  supabase: ReturnType<typeof createServiceClient>,
): Promise<AlertRow[]> {
  const { data, error } = await supabase
    .from("intelligence_alerts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) {
    console.error("Failed to fetch intelligence alerts:", error.message);
    return [];
  }

  const rows = data ?? [];
  const entityIds = [...new Set(rows.map((r: Record<string, unknown>) => r.entity_id as string))];
  const nameMap: Record<string, string> = {};

  if (entityIds.length > 0) {
    const [adsResult, campaignsResult, adsetsResult] = await Promise.all([
      supabase.from("ads").select("id, name").in("id", entityIds),
      supabase.from("campaigns").select("id, name").in("id", entityIds),
      supabase.from("adsets").select("id, name").in("id", entityIds),
    ]);

    for (const ad of adsResult.data ?? []) nameMap[ad.id] = ad.name;
    for (const c of campaignsResult.data ?? []) { if (!nameMap[c.id]) nameMap[c.id] = c.name; }
    for (const a of adsetsResult.data ?? []) { if (!nameMap[a.id]) nameMap[a.id] = a.name; }

    for (const row of rows) {
      (row as Record<string, unknown>).entity_name = nameMap[(row as Record<string, unknown>).entity_id as string] ?? null;
    }
  }

  return rows as unknown as AlertRow[];
}

// ---------------------------------------------------------------------------
// Freshness data fetching (mirrors /api/sync/status logic)
// ---------------------------------------------------------------------------

async function fetchFreshnessData(
  supabase: ReturnType<typeof createServiceClient>,
): Promise<FreshnessBannerData | null> {
  try {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: logs, error } = await supabase
      .from("sync_logs")
      .select("source, status, completed_at, stage")
      .gte("started_at", oneDayAgo)
      .order("started_at", { ascending: false });

    if (error) {
      console.error("Failed to fetch sync logs:", error.message);
      return null;
    }

    const syncLogs: SyncLogRow[] = (logs ?? []).map((row) => ({
      source: row.source,
      status: row.status,
      completed_at: row.completed_at,
      stage: row.stage,
    }));

    const freshness = computeFreshness(syncLogs);

    // Check if a sync is currently running
    const { data: latestOrchestrate } = await supabase
      .from("sync_logs")
      .select("sync_batch_id, status")
      .eq("source", "combined")
      .eq("stage", "orchestrate")
      .order("started_at", { ascending: false })
      .limit(2);

    let isRunning = false;

    if (latestOrchestrate && latestOrchestrate.length > 0) {
      const latest = latestOrchestrate[0];
      if (latest.status === "running") {
        const hasCompleted = latestOrchestrate.some(
          (r) => r.sync_batch_id === latest.sync_batch_id && r.status !== "running",
        );
        if (!hasCompleted) {
          const { data: completedCheck } = await supabase
            .from("sync_logs")
            .select("sync_batch_id")
            .eq("source", "combined")
            .eq("stage", "orchestrate")
            .eq("sync_batch_id", latest.sync_batch_id)
            .in("status", ["success", "failed"])
            .limit(1);
          isRunning = (completedCheck ?? []).length === 0;
        }
      }
    }

    return { freshness, isRunning };
  } catch (err) {
    console.error("Freshness data fetch error:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Budget data fetching (mirrors /api/intelligence/budget logic)
// ---------------------------------------------------------------------------

async function fetchBudgetData(
  supabase: ReturnType<typeof createServiceClient>,
  freshnessState: FreshnessState,
): Promise<{ data: BudgetApiData | null; meta: BudgetApiMeta }> {
  if (freshnessState === "stale" || freshnessState === "degraded") {
    return {
      data: {
        recommendations: [],
        pauseCandidates: [],
        scaleCandidates: [],
        totalCurrentSpend: 0,
        suggestedReallocation: 0,
      },
      meta: {
        suppressed: true,
        reason: `Data freshness is ${freshnessState} — budget recommendations suppressed`,
      },
    };
  }

  try {
    const persistence: BudgetPersistence = {
      async fetchEntitiesWithSpend(): Promise<BudgetEntityInput[]> {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const dateFrom = sevenDaysAgo.toISOString().slice(0, 10);
        const dateTo = new Date().toISOString().slice(0, 10);

        const { data, error } = await supabase.rpc("aggregate_entity_funnel", {
          date_from: dateFrom,
          date_to: dateTo,
        });

        if (error || !data) return [];

        return (data as Array<{
          entity_id: string;
          entity_level: string;
          spend: number;
          visits: number;
          chats: number;
          reveals: number;
          click_throughs: number;
        }>).map((row) => {
          const spend = Number(row.spend);
          const visits = Number(row.visits);
          const chats = Number(row.chats);
          const reveals = Number(row.reveals);
          return {
            entityId: row.entity_id,
            entityLevel: row.entity_level as "campaign" | "adset" | "ad",
            spend,
            visits,
            chat_rate: visits > 0 ? chats / visits : null,
            cost_per_chat: chats > 0 ? spend / chats : null,
            reveal_rate: chats > 0 ? reveals / chats : null,
            freshnessState: null,
          };
        });
      },
    };

    const result = await generateBudgetRecommendations(persistence);

    // Resolve entity names
    const entityIds = result.recommendations.map((r) => r.entityId);
    if (entityIds.length > 0) {
      const { data: ads } = await supabase.from("ads").select("id, name").in("id", entityIds);
      const nameMap = new Map<string, string>();
      for (const ad of ads ?? []) nameMap.set(ad.id, ad.name);

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

    return {
      data: result as unknown as BudgetApiData,
      meta: { suppressed: false },
    };
  } catch (err) {
    console.error("Budget recommendations error:", err);
    return { data: null, meta: { suppressed: false } };
  }
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminUser();

  const resolvedParams = await searchParams;
  const period = (typeof resolvedParams.period === "string" ? resolvedParams.period : null) ?? "7d";

  const supabase = createServiceClient();

  // Fetch all data in parallel (freshness first since budget depends on it)
  const validPeriodForFunnel = isValidPeriod(period) ? period : "7d";
  const { current: funnelRange } = getDateRanges(validPeriodForFunnel);

  const [kpis, scorecardRows, alerts, freshnessData, funnelAgg] = await Promise.all([
    fetchKpiData(supabase, period),
    fetchScorecardData(supabase, period),
    fetchAlerts(supabase),
    fetchFreshnessData(supabase),
    fetchAggregated(supabase, funnelRange),
  ]);

  const funnelSteps: FunnelStep[] = [
    { label: "Visits", value: funnelAgg.visits || null },
    { label: "Chats", value: funnelAgg.chats || null },
    { label: "Reveals", value: funnelAgg.reveals || null },
    { label: "Clicks", value: funnelAgg.clicks || null },
  ];

  // Budget depends on freshness state
  const freshnessState = freshnessData?.freshness.state ?? "stale";
  const { data: budgetData, meta: budgetMeta } = await fetchBudgetData(supabase, freshnessState);

  return (
    <section className="overview-page">
      <h1 className="page-title">Overview</h1>

      <FreshnessBanner data={freshnessData} />

      <KpiBar kpis={kpis} />

      <h2 className="section-title">Conversion Funnel</h2>
      <FunnelChart steps={funnelSteps} />

      <h2 className="section-title">Active Ads — Ranked by Cost per Chat</h2>

      <ScorecardTable rows={scorecardRows} period={period} />

      <OverviewAlerts alerts={alerts} />

      <BudgetSection
        freshnessState={freshnessState}
        data={budgetData}
        meta={budgetMeta}
      />
    </section>
  );
}
