/**
 * GET /api/entity/ads-by-adset?adset_id=xxx
 *
 * Returns ads for a given adset, plus adset and campaign names.
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

  const adsetId = request.nextUrl.searchParams.get("adset_id");
  if (!adsetId) {
    return Response.json({ error: "Missing adset_id" }, { status: 400 });
  }

  const supabase = createServiceClient();

  const [adsResult, adsetResult] = await Promise.all([
    supabase
      .from("ads")
      .select("id, name, campaign_id")
      .eq("adset_id", adsetId),
    supabase
      .from("adsets")
      .select("id, name, campaign_id")
      .eq("id", adsetId)
      .single(),
  ]);

  // Look up campaign name
  let campaignName = "";
  if (adsetResult.data?.campaign_id) {
    const { data: campData } = await supabase
      .from("campaigns")
      .select("name")
      .eq("id", adsetResult.data.campaign_id)
      .single();
    campaignName = campData?.name ?? "";
  }

  return new Response(JSON.stringify({
    ads: adsResult.data ?? [],
    adset_name: adsetResult.data?.name ?? adsetId,
    campaign_id: adsetResult.data?.campaign_id ?? "",
    campaign_name: campaignName,
  }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, s-maxage=900, stale-while-revalidate=1800',
    },
  });
}
