/**
 * GET /api/storage/full-image?ad_id=xxx
 *
 * Returns a signed URL for a single ad's full-size creative image.
 * Falls back to the thumbnail storage path if no full-size image is available.
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
    .select("creative_full_path, creative_storage_path")
    .eq("id", adId)
    .single();

  // Prefer full-size path, fall back to thumbnail path
  const storagePath = ad?.creative_full_path ?? ad?.creative_storage_path;

  if (!storagePath) {
    return Response.json({ error: "No image available" }, { status: 404 });
  }

  const { data: signedUrlData, error } = await supabase.storage
    .from("ad-creatives")
    .createSignedUrl(storagePath, SIGNED_URL_EXPIRY);

  if (error || !signedUrlData?.signedUrl) {
    return Response.json({ error: "Failed to generate URL" }, { status: 500 });
  }

  return Response.json({
    url: signedUrlData.signedUrl,
    is_full_size: !!ad?.creative_full_path,
  });
}
