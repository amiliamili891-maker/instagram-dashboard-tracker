/**
 * GET /api/entity/ad-detail?ad_id=xxx
 *
 * Returns ad metadata including campaign and adset names.
 */

import { type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAdminUser } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await requireAdminUser();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adId = request.nextUrl.searchParams.get("ad_id");
  if (!adId) {
    return Response.json({ error: "Missing ad_id" }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data: ad } = await supabase
    .from("ads")
    .select("id, name, campaign_id, adset_id, format_category, emotional_trigger, text_angle")
    .eq("id", adId)
    .single();

  if (!ad) {
    return Response.json({
      ad_name: adId,
      campaign_id: "",
      campaign_name: "",
      adset_id: "",
      adset_name: "",
    });
  }

  const [campaignResult, adsetResult] = await Promise.all([
    supabase.from("campaigns").select("name").eq("id", ad.campaign_id).single(),
    supabase.from("adsets").select("name").eq("id", ad.adset_id).single(),
  ]);

  return new Response(JSON.stringify({
    ad_name: ad.name,
    campaign_id: ad.campaign_id,
    campaign_name: campaignResult.data?.name ?? ad.campaign_id,
    adset_id: ad.adset_id,
    adset_name: adsetResult.data?.name ?? ad.adset_id,
    format_category: ad.format_category ?? null,
    emotional_trigger: ad.emotional_trigger ?? null,
    text_angle: ad.text_angle ?? null,
  }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, s-maxage=900, stale-while-revalidate=1800',
    },
  });
}
