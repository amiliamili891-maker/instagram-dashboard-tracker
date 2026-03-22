/**
 * GET /api/entity/ads?campaign_id=xxx
 *
 * Returns ads and adsets for a given campaign.
 * Used by the campaign detail page to map ad stats to adsets.
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

  const campaignId = request.nextUrl.searchParams.get("campaign_id");
  if (!campaignId) {
    return Response.json({ error: "Missing campaign_id" }, { status: 400 });
  }

  const supabase = createServiceClient();

  const [adsResult, adsetsResult, campaignResult] = await Promise.all([
    supabase
      .from("ads")
      .select("id, name, adset_id, campaign_id")
      .eq("campaign_id", campaignId),
    supabase
      .from("adsets")
      .select("id, name")
      .eq("campaign_id", campaignId),
    supabase
      .from("campaigns")
      .select("name")
      .eq("id", campaignId)
      .single(),
  ]);

  return new Response(JSON.stringify({
    ads: adsResult.data ?? [],
    adsets: adsetsResult.data ?? [],
    campaign_name: campaignResult.data?.name ?? campaignId,
  }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, s-maxage=900, stale-while-revalidate=1800',
    },
  });
}
