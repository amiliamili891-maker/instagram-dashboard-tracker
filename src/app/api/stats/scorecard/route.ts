/**
 * GET /api/stats/scorecard
 *
 * Returns ad-level ranked scorecard data for the overview page.
 * Sorted by cost_per_chat ascending (best performing first).
 * Ads with fewer than 5 chats are marked insufficient_data.
 *
 * Query params:
 *   - period: today | yesterday | 3d | 7d | 14d | 30d
 */

import { type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAdminUser } from "@/lib/auth/guards";
import { getDateRanges, isValidPeriod } from "@/lib/date-utils";

export const dynamic = "force-dynamic";

const MIN_CHATS_THRESHOLD = 5;

export async function GET(request: NextRequest) {
  try {
    await requireAdminUser();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const periodParam = searchParams.get("period");
  const period = isValidPeriod(periodParam) ? periodParam : "7d";

  const { current: range } = getDateRanges(period);
  const supabase = createServiceClient();

  // Use RPC to aggregate server-side instead of fetching all rows
  const { data: statsData, error: statsError } = await supabase.rpc(
    "aggregate_scorecard",
    {
      date_from: range.from,
      date_to: range.to,
    },
  );

  if (statsError) {
    console.error("Scorecard RPC error:", statsError.message);
    return Response.json({ error: "Failed to fetch stats" }, { status: 500 });
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

  // Fetch ad metadata (name, campaign, adset)
  const adIds = aggregatedRows.map((r) => r.entity_id);
  let adsMap = new Map<
    string,
    { name: string; campaign_id: string; adset_id: string }
  >();
  let campaignsMap = new Map<string, string>();
  let adsetsMap = new Map<string, string>();

  if (adIds.length > 0) {
    const { data: adsData } = await supabase
      .from("ads")
      .select("id, name, campaign_id, adset_id")
      .in("id", adIds);

    for (const ad of adsData ?? []) {
      adsMap.set(ad.id, {
        name: ad.name,
        campaign_id: ad.campaign_id,
        adset_id: ad.adset_id,
      });
    }

    // Get campaign and adset names in parallel
    const campaignIds = [
      ...new Set((adsData ?? []).map((a) => a.campaign_id)),
    ];
    const adsetIds = [
      ...new Set(
        (adsData ?? []).map((a) => a.adset_id).filter(Boolean),
      ),
    ];

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
  }

  // Build rows
  const rows = aggregatedRows.map((agg) => {
    const adMeta = adsMap.get(agg.entity_id);
    const insufficient = Number(agg.chats) < MIN_CHATS_THRESHOLD;
    const costPerChat =
      Number(agg.chats) > 0 ? Number(agg.spend) / Number(agg.chats) : null;
    const chatRate = Number(agg.visits) > 0 ? Number(agg.chats) / Number(agg.visits) : null;
    const revealRate = Number(agg.chats) > 0 ? Number(agg.reveals) / Number(agg.chats) : null;

    return {
      entity_id: agg.entity_id,
      ad_name: adMeta?.name ?? agg.entity_id,
      campaign_id: adMeta?.campaign_id ?? "",
      campaign_name: adMeta
        ? campaignsMap.get(adMeta.campaign_id) ?? adMeta.campaign_id
        : "",
      adset_id: adMeta?.adset_id ?? "",
      adset_name: adMeta
        ? adsetsMap.get(adMeta.adset_id) ?? adMeta.adset_id
        : "",
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

  return new Response(JSON.stringify({ rows, period }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, s-maxage=900, stale-while-revalidate=1800',
    },
  });
}
