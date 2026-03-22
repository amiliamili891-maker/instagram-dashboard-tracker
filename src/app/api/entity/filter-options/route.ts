/**
 * GET /api/entity/filter-options
 *
 * Returns all campaigns, adsets, and ads with id and name.
 * Used by session filter dropdowns to replace raw UUID inputs.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { requireAdminUser } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdminUser();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  const [campaignsResult, adsetsResult, adsResult] = await Promise.all([
    supabase.from("campaigns").select("id, name"),
    supabase.from("adsets").select("id, name, campaign_id"),
    supabase.from("ads").select("id, name, adset_id, campaign_id"),
  ]);

  return new Response(
    JSON.stringify({
      campaigns: campaignsResult.data ?? [],
      adsets: adsetsResult.data ?? [],
      ads: adsResult.data ?? [],
    }),
    {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "private, s-maxage=900, stale-while-revalidate=1800",
      },
    }
  );
}
