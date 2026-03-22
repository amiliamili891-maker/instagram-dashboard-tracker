/**
 * GET /api/entity/campaigns
 *
 * Returns all campaigns with id and name.
 * Used by campaign-list to resolve names from IDs.
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
  const { data, error } = await supabase
    .from("campaigns")
    .select("id, name");

  if (error) {
    return Response.json({ error: "Failed to fetch campaigns" }, { status: 500 });
  }

  return new Response(JSON.stringify({ campaigns: data ?? [] }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, s-maxage=900, stale-while-revalidate=1800',
    },
  });
}
