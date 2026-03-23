/**
 * POST /api/deploy/ad
 *
 * Deploy an ad creative to Meta Ads.
 * Resolves image from Supabase Storage or external URL,
 * then calls the 3-step Meta API flow (upload → creative → ad).
 */

import { createServiceClient } from '@/lib/supabase/service';
import { requireAdminUser } from '@/lib/auth/guards';
import { isValidAdName } from '@/lib/deploy/naming';
import { deployAdToMeta } from '@/lib/api/meta-deploy';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
  // 1. Auth
  try {
    await requireAdminUser();
  } catch {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. Parse & validate body
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const {
    storage_path,
    image_url,
    ad_name,
    primary_text,
    headline,
    ad_set_id,
    paused,
  } = body as {
    storage_path?: string;
    image_url?: string;
    ad_name?: string;
    primary_text?: string;
    headline?: string;
    ad_set_id?: string;
    paused?: boolean;
  };

  // Required fields
  if (!ad_name || typeof ad_name !== 'string') {
    return Response.json({ error: 'ad_name is required' }, { status: 400 });
  }

  if (!isValidAdName(ad_name)) {
    return Response.json(
      { error: 'ad_name does not follow the naming convention' },
      { status: 400 },
    );
  }

  if (!primary_text || typeof primary_text !== 'string') {
    return Response.json(
      { error: 'primary_text is required' },
      { status: 400 },
    );
  }

  if (!headline || typeof headline !== 'string') {
    return Response.json({ error: 'headline is required' }, { status: 400 });
  }

  if (!ad_set_id || typeof ad_set_id !== 'string') {
    return Response.json({ error: 'ad_set_id is required' }, { status: 400 });
  }

  // Exactly one image source
  if (storage_path && image_url) {
    return Response.json(
      { error: 'Provide either storage_path or image_url, not both' },
      { status: 400 },
    );
  }

  if (!storage_path && !image_url) {
    return Response.json(
      { error: 'Either storage_path or image_url is required' },
      { status: 400 },
    );
  }

  // 3. Resolve image to Buffer
  let imageBuffer: Buffer;

  if (storage_path) {
    const supabase = createServiceClient();
    const { data, error } = await supabase.storage
      .from('ad-creatives')
      .download(storage_path);

    if (error || !data) {
      console.error('Supabase storage download failed:', error);
      return Response.json(
        {
          error: `Failed to download image from storage: ${error?.message ?? 'no data'}`,
        },
        { status: 400 },
      );
    }

    imageBuffer = Buffer.from(await data.arrayBuffer());
  } else {
    // image_url
    try {
      const resp = await fetch(image_url!, {
        signal: AbortSignal.timeout(30_000),
      });

      if (!resp.ok) {
        return Response.json(
          { error: `Failed to fetch image URL: ${resp.status} ${resp.statusText}` },
          { status: 400 },
        );
      }

      imageBuffer = Buffer.from(await resp.arrayBuffer());
    } catch (err: unknown) {
      const error = err as Error;
      console.error('Image URL fetch failed:', error);
      return Response.json(
        { error: `Failed to fetch image URL: ${error.message}` },
        { status: 400 },
      );
    }
  }

  if (imageBuffer.length === 0) {
    return Response.json(
      { error: 'Resolved image is empty (0 bytes)' },
      { status: 400 },
    );
  }

  // 4. Deploy to Meta
  const isPaused = paused !== false; // default true (safe)

  try {
    const result = await deployAdToMeta({
      imageSource: { type: 'buffer', data: imageBuffer },
      adName: ad_name,
      primaryText: primary_text,
      headline,
      adSetId: ad_set_id,
      paused: isPaused,
    });

    // 5. Success response
    return Response.json({
      ad_id: result.adId,
      ad_creative_id: result.adCreativeId,
      image_hash: result.imageHash,
      preview_url: result.previewUrl,
      ad_name,
      status: isPaused ? 'PAUSED' : 'ACTIVE',
    });
  } catch (err: unknown) {
    const error = err as Error;
    console.error('Meta ad deployment failed:', error);
    return Response.json(
      { error: `Meta deployment failed: ${error.message}` },
      { status: 502 },
    );
  }
}
