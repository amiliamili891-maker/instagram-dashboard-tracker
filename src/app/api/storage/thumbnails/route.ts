/**
 * GET /api/storage/thumbnails?ad_ids=id1,id2,id3
 *
 * Batch signed URL generation for multiple ad thumbnails.
 * Used by scorecard and drill-down tables to avoid N+1 requests.
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

  const adIdsParam = request.nextUrl.searchParams.get("ad_ids");
  if (!adIdsParam) {
    return Response.json({ error: "Missing ad_ids" }, { status: 400 });
  }

  const adIds = adIdsParam.split(",").filter(Boolean).slice(0, 100);
  const supabase = createServiceClient();

  const { data: ads } = await supabase
    .from("ads")
    .select("id, creative_storage_path")
    .in("id", adIds)
    .not("creative_storage_path", "is", null);

  const adsWithPaths = (ads ?? []).filter((a) => a.creative_storage_path);

  if (adsWithPaths.length === 0) {
    return Response.json({ thumbnails: {} });
  }

  // Use batch signed URL generation
  const paths = adsWithPaths.map((a) => a.creative_storage_path!);
  const { data: signedUrls } = await supabase.storage
    .from("ad-creatives")
    .createSignedUrls(paths, SIGNED_URL_EXPIRY);

  const pathToAdId = new Map(
    adsWithPaths.map((a) => [a.creative_storage_path, a.id]),
  );

  const result: Record<string, string> = {};
  for (const entry of signedUrls ?? []) {
    if (entry.signedUrl) {
      const adId = pathToAdId.get(entry.path);
      if (adId) result[adId] = entry.signedUrl;
    }
  }

  return new Response(JSON.stringify({ thumbnails: result }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, s-maxage=900, stale-while-revalidate=1800',
    },
  });
}
