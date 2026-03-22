/**
 * GET /api/stats/overview
 *
 * Returns aggregated KPIs for a date range with comparison deltas.
 *
 * Query params:
 *   - period: today | yesterday | 3d | 7d | 14d | 30d (default: 7d)
 *
 * Returns:
 *   - kpis: { metric, current, comparison, delta_pct } for each KPI
 *   - dateRange: { current, comparison }
 */

import { type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAdminUser } from "@/lib/auth/guards";
import {
  getDateRanges,
  isValidPeriod,
  type DateRange,
} from "@/lib/date-utils";

export const dynamic = "force-dynamic";

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
    return {
      spend: 0,
      clicks: 0,
      impressions: 0,
      unique_clicks: 0,
      chats: 0,
      visits: 0,
      reveals: 0,
    };
  }

  // RPC returns an array with a single row
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return {
      spend: 0,
      clicks: 0,
      impressions: 0,
      unique_clicks: 0,
      chats: 0,
      visits: 0,
      reveals: 0,
    };
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

function computeDelta(
  current: number | null,
  comparison: number | null,
): number | null {
  if (current === null || comparison === null || comparison === 0) return null;
  return ((current - comparison) / comparison) * 100;
}

export async function GET(request: NextRequest) {
  try {
    await requireAdminUser();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const periodParam = searchParams.get("period");
  const period = isValidPeriod(periodParam) ? periodParam : "7d";

  const { current: currentRange, comparison: compRange } =
    getDateRanges(period);

  const supabase = createServiceClient();

  const [currentAgg, compAgg] = await Promise.all([
    fetchAggregated(supabase, currentRange),
    fetchAggregated(supabase, compRange),
  ]);

  const currentKpis = computeKpis(currentAgg);
  const compKpis = computeKpis(compAgg);

  const kpis = [
    {
      metric: "spend",
      label: "Spend",
      current: currentKpis.spend,
      comparison: compKpis.spend,
      delta_pct: computeDelta(currentKpis.spend, compKpis.spend),
      format: "currency",
    },
    {
      metric: "cost_per_chat",
      label: "Cost per Chat",
      current: currentKpis.cost_per_chat,
      comparison: compKpis.cost_per_chat,
      delta_pct: computeDelta(
        currentKpis.cost_per_chat,
        compKpis.cost_per_chat,
      ),
      format: "currency",
      invert: true, // lower is better
    },
    {
      metric: "chat_rate",
      label: "Chat Rate",
      current: currentKpis.chat_rate,
      comparison: compKpis.chat_rate,
      delta_pct: computeDelta(currentKpis.chat_rate, compKpis.chat_rate),
      format: "percent",
    },
    {
      metric: "reveal_rate",
      label: "Reveal Rate",
      current: currentKpis.reveal_rate,
      comparison: compKpis.reveal_rate,
      delta_pct: computeDelta(currentKpis.reveal_rate, compKpis.reveal_rate),
      format: "percent",
    },
    {
      metric: "cost_per_unique_click",
      label: "Cost/Unique Click",
      current: currentKpis.cost_per_unique_click,
      comparison: compKpis.cost_per_unique_click,
      delta_pct: computeDelta(
        currentKpis.cost_per_unique_click,
        compKpis.cost_per_unique_click,
      ),
      format: "currency",
      invert: true,
    },
    {
      metric: "ctr",
      label: "CTR",
      current: currentKpis.ctr,
      comparison: compKpis.ctr,
      delta_pct: computeDelta(currentKpis.ctr, compKpis.ctr),
      format: "percent",
    },
  ];

  return new Response(JSON.stringify({
    kpis,
    dateRange: {
      current: currentRange,
      comparison: compRange,
    },
    period,
  }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, s-maxage=900, stale-while-revalidate=1800',
    },
  });
}
