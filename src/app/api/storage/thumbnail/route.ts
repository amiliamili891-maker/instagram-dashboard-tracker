/**
 * GET /api/storage/thumbnail?ad_id=xxx
 *
 * Returns a signed URL for a single ad's creative thumbnail.
 */

import { type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAdminUser } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

const SIGNED_URL_EXPIRY = 3600; // 1 hour

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
    .select("creative_storage_path")
    .eq("id", adId)
    .single();

  if (!ad?.creative_storage_path) {
    return Response.json({ error: "No thumbnail available" }, { status: 404 });
  }

  const { data: signedUrlData, error } = await supabase.storage
    .from("ad-creatives")
    .createSignedUrl(ad.creative_storage_path, SIGNED_URL_EXPIRY);

  if (error || !signedUrlData?.signedUrl) {
    return Response.json({ error: "Failed to generate URL" }, { status: 500 });
  }

  return new Response(JSON.stringify({ url: signedUrlData.signedUrl }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, s-maxage=900, stale-while-revalidate=1800',
    },
  });
}
