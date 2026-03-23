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
import { deployAdToMeta, MetaDeployError } from '@/lib/api/meta-deploy';
import * as dns from 'node:dns/promises';
import * as net from 'node:net';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// URL validation — prevent SSRF
// ---------------------------------------------------------------------------

const PRIVATE_RANGES = [
  // IPv4
  { prefix: '10.', mask: null },
  { prefix: '172.', mask: (ip: string) => { const b = parseInt(ip.split('.')[1]); return b >= 16 && b <= 31; } },
  { prefix: '192.168.', mask: null },
  { prefix: '169.254.', mask: null },
  { prefix: '127.', mask: null },
  { prefix: '0.', mask: null },
];

function isPrivateIP(ip: string): boolean {
  // IPv6
  if (ip === '::1' || ip.startsWith('fe80:') || ip === '::') return true;
  // IPv4-mapped IPv6
  if (ip.startsWith('::ffff:')) {
    const v4 = ip.slice(7);
    return isPrivateIP(v4);
  }
  for (const range of PRIVATE_RANGES) {
    if (ip.startsWith(range.prefix)) {
      if (!range.mask) return true;
      if (range.mask(ip)) return true;
    }
  }
  return false;
}

async function validatePublicUrl(url: string): Promise<{ valid: boolean; error?: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, error: 'Invalid image URL: malformed URL' };
  }

  if (parsed.protocol !== 'https:') {
    return { valid: false, error: 'Invalid image URL: only public HTTPS URLs are allowed' };
  }

  // Resolve hostname and check for private IPs
  try {
    const hostname = parsed.hostname;
    // Check if hostname is already an IP
    if (net.isIP(hostname)) {
      if (isPrivateIP(hostname)) {
        return { valid: false, error: 'Invalid image URL: only public HTTPS URLs are allowed' };
      }
      return { valid: true };
    }
    // DNS resolve
    const addresses = await dns.resolve4(hostname).catch(() => [] as string[]);
    const addresses6 = await dns.resolve6(hostname).catch(() => [] as string[]);
    const all = [...addresses, ...addresses6];
    if (all.length === 0) {
      return { valid: false, error: 'Invalid image URL: hostname could not be resolved' };
    }
    for (const addr of all) {
      if (isPrivateIP(addr)) {
        return { valid: false, error: 'Invalid image URL: only public HTTPS URLs are allowed' };
      }
    }
    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid image URL: hostname could not be resolved' };
  }
}

// ---------------------------------------------------------------------------
// Storage path validation — prevent path traversal
// ---------------------------------------------------------------------------

function validateStoragePath(path: string): { valid: boolean; error?: string } {
  if (path.includes('..')) {
    return { valid: false, error: 'Invalid storage path' };
  }
  if (path.startsWith('/')) {
    return { valid: false, error: 'Invalid storage path' };
  }
  if (!path.startsWith('generated/') && !path.startsWith('thumbnails/')) {
    return { valid: false, error: 'Invalid storage path' };
  }
  return { valid: true };
}

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

  if (!/^\d+$/.test(ad_set_id)) {
    return Response.json(
      { error: 'ad_set_id must be a numeric string' },
      { status: 400 },
    );
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
    const pathCheck = validateStoragePath(storage_path);
    if (!pathCheck.valid) {
      return Response.json({ error: pathCheck.error }, { status: 400 });
    }

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
    // image_url — validate before fetching (SSRF protection)
    const urlCheck = await validatePublicUrl(image_url!);
    if (!urlCheck.valid) {
      return Response.json({ error: urlCheck.error }, { status: 400 });
    }

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
    const step = err instanceof MetaDeployError ? err.step : 'unknown';
    return Response.json(
      { error: `Meta deployment failed at step: ${step}` },
      { status: 502 },
    );
  }
}
