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

  // Fetch ad-level combined stats for the period
  const { data: statsData, error: statsError } = await supabase
    .from("daily_combined_stats")
    .select("*")
    .eq("entity_level", "ad")
    .gte("report_date", range.from)
    .lte("report_date", range.to);

  if (statsError) {
    console.error("Scorecard stats error:", statsError.message);
    return Response.json({ error: "Failed to fetch stats" }, { status: 500 });
  }

  // Aggregate by entity_id across dates
  const aggMap = new Map<
    string,
    {
      entity_id: string;
      spend: number;
      chats: number;
      visits: number;
      reveals: number;
      impressions: number;
      clicks: number;
      unique_clicks: number;
    }
  >();

  for (const row of statsData ?? []) {
    const existing = aggMap.get(row.entity_id) ?? {
      entity_id: row.entity_id,
      spend: 0,
      chats: 0,
      visits: 0,
      reveals: 0,
      impressions: 0,
      clicks: 0,
      unique_clicks: 0,
    };
    existing.spend += Number(row.spend) || 0;
    existing.chats += Number(row.chats) || 0;
    existing.visits += Number(row.visits) || 0;
    existing.reveals += Number(row.reveals) || 0;
    existing.impressions += Number(row.impressions) || 0;
    existing.clicks += Number(row.clicks) || 0;
    existing.unique_clicks += Number(row.unique_clicks) || 0;
    aggMap.set(row.entity_id, existing);
  }

  // Fetch ad metadata (name, campaign, adset)
  const adIds = Array.from(aggMap.keys());
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

    // Get campaign names
    const campaignIds = [
      ...new Set((adsData ?? []).map((a) => a.campaign_id)),
    ];
    if (campaignIds.length > 0) {
      const { data: campData } = await supabase
        .from("campaigns")
        .select("id, name")
        .in("id", campaignIds);
      for (const c of campData ?? []) {
        campaignsMap.set(c.id, c.name);
      }
    }

    // Get adset names
    const adsetIds = [
      ...new Set(
        (adsData ?? []).map((a) => a.adset_id).filter(Boolean),
      ),
    ];
    if (adsetIds.length > 0) {
      const { data: asData } = await supabase
        .from("adsets")
        .select("id, name")
        .in("id", adsetIds);
      for (const a of asData ?? []) {
        adsetsMap.set(a.id, a.name);
      }
    }
  }

  // Build rows
  const rows = Array.from(aggMap.values()).map((agg) => {
    const adMeta = adsMap.get(agg.entity_id);
    const insufficient = agg.chats < MIN_CHATS_THRESHOLD;
    const costPerChat =
      agg.chats > 0 ? agg.spend / agg.chats : null;
    const chatRate = agg.visits > 0 ? agg.chats / agg.visits : null;
    const revealRate = agg.chats > 0 ? agg.reveals / agg.chats : null;

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
      spend: agg.spend,
      cost_per_chat: insufficient ? null : costPerChat,
      chat_rate: chatRate,
      reveal_rate: revealRate,
      chats: agg.chats,
      visits: agg.visits,
      reveals: agg.reveals,
      impressions: agg.impressions,
      clicks: agg.clicks,
      unique_clicks: agg.unique_clicks,
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

  return Response.json({ rows, period });
}
