/**
 * Meta Marketing API v21.0 — write-side client.
 *
 * Handles ad creation: image upload, ad creative creation, and ad creation.
 * The read-side client lives in meta-client.ts.
 *
 * Auth follows the same pattern as meta-client.ts: access_token query param,
 * retry on 429 with exponential backoff [2s, 8s, 32s].
 */

import { getServerEnv } from '@/lib/env';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_URL = 'https://graph.facebook.com/v21.0';
const BACKOFF_MS = [2_000, 8_000, 32_000];
const MAX_RETRIES = 3;

const PAGE_ID = '1042335508957186';
const INSTAGRAM_ACTOR_ID = '17841477059703485';
const LANDING_URL = 'https://ghstly.chat/';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeployAdInput {
  /** Image bytes (Buffer) or URL to an already-uploaded image */
  imageSource: { type: 'buffer'; data: Buffer } | { type: 'url'; url: string };
  /** Ad name — must follow naming convention */
  adName: string;
  /** Primary text shown below the image */
  primaryText: string;
  /** Headline text */
  headline: string;
  /** Target ad set ID — the ad will be created inside this ad set */
  adSetId: string;
  /** Whether to create the ad as PAUSED (default true — safer) */
  paused?: boolean;
}

export interface DeployAdResult {
  /** Meta ad ID */
  adId: string;
  /** Meta ad creative ID */
  adCreativeId: string;
  /** Image hash from upload */
  imageHash: string;
  /** Ad preview URL */
  previewUrl: string | null;
}

// ---------------------------------------------------------------------------
// Error class (matches meta-client.ts pattern)
// ---------------------------------------------------------------------------

export class MetaDeployError extends Error {
  constructor(
    message: string,
    public readonly step: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'MetaDeployError';
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Redact Meta access tokens (EAA...) and truncate error bodies
 * to prevent token leakage in error messages.
 */
function redactTokens(text: string): string {
  return text.replace(/EAA[A-Za-z0-9]{20,}/g, '[REDACTED_TOKEN]');
}

function sanitizeErrorBody(body: string, maxLen = 200): string {
  const truncated = body.length > maxLen ? body.slice(0, maxLen) + '...' : body;
  return redactTokens(truncated);
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

async function isRateLimitError(response: Response): Promise<boolean> {
  try {
    const body = (await response.json()) as { error?: { code?: number } };
    const code = body?.error?.code;
    return code === 17 || code === 32;
  } catch {
    return false;
  }
}

/**
 * POST with retry logic matching meta-client.ts.
 * Supports both JSON params (as URL search params) and multipart/form-data.
 */
async function postWithRetry(
  url: string,
  options: {
    params?: Record<string, string>;
    formData?: FormData;
    accessToken: string;
  },
): Promise<unknown> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let response: Response;

    if (options.formData) {
      // Multipart — append access_token to the form data
      const fd = new FormData();
      // Copy entries from the provided FormData
      for (const [key, value] of options.formData.entries()) {
        fd.append(key, value);
      }
      fd.append('access_token', options.accessToken);
      response = await fetch(url, { method: 'POST', body: fd });
    } else {
      // URL-encoded params
      const searchParams = new URLSearchParams({
        ...options.params,
        access_token: options.accessToken,
      });
      response = await fetch(`${url}?${searchParams.toString()}`, {
        method: 'POST',
      });
    }

    if (response.status === 429 || (await isRateLimitError(response.clone()))) {
      if (attempt < MAX_RETRIES) {
        const wait = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
        await sleep(wait);
        continue;
      }
    }

    if (!response.ok) {
      const body = await response.text();
      if (isRetryableStatus(response.status) && attempt < MAX_RETRIES) {
        const wait = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
        await sleep(wait);
        continue;
      }
      throw new MetaDeployError(
        `Meta API ${response.status}: ${sanitizeErrorBody(body)}`,
        'request',
        response.status,
      );
    }

    return response.json();
  }

  throw new MetaDeployError('Exhausted retries', 'request', 429);
}

// ---------------------------------------------------------------------------
// Main deploy function
// ---------------------------------------------------------------------------

export async function deployAdToMeta(input: DeployAdInput): Promise<DeployAdResult> {
  const env = getServerEnv();
  const accessToken = env.metaAccessToken;
  const accountId = env.metaAdAccountId.startsWith('act_')
    ? env.metaAdAccountId
    : `act_${env.metaAdAccountId}`;

  const paused = input.paused ?? true;

  // Step 1: Upload image
  let imageHash: string;
  try {
    let imageBase64: string;

    if (input.imageSource.type === 'url') {
      const imgResponse = await fetch(input.imageSource.url);
      if (!imgResponse.ok) {
        throw new Error(`Failed to fetch image from URL: ${imgResponse.status}`);
      }
      const arrayBuffer = await imgResponse.arrayBuffer();
      imageBase64 = Buffer.from(arrayBuffer).toString('base64');
    } else {
      imageBase64 = input.imageSource.data.toString('base64');
    }

    const formData = new FormData();
    formData.append('bytes', imageBase64);

    const uploadResult = (await postWithRetry(
      `${BASE_URL}/${accountId}/adimages`,
      { formData, accessToken },
    )) as { images: Record<string, { hash: string; url: string }> };

    // The response key is the field name used in the upload ("bytes")
    const imageData = uploadResult.images?.bytes;
    if (!imageData?.hash) {
      throw new Error(
        `Unexpected upload response: ${JSON.stringify(uploadResult)}`,
      );
    }
    imageHash = imageData.hash;
  } catch (error) {
    if (error instanceof MetaDeployError) throw error;
    throw new MetaDeployError(
      `Image upload failed: ${redactTokens(error instanceof Error ? error.message : String(error))}`,
      'image_upload',
    );
  }

  // Step 2: Create ad creative
  let adCreativeId: string;
  try {
    const objectStorySpec = JSON.stringify({
      page_id: PAGE_ID,
      instagram_actor_id: INSTAGRAM_ACTOR_ID,
      link_data: {
        image_hash: imageHash,
        link: LANDING_URL,
        message: input.primaryText,
        name: input.headline,
        call_to_action: { type: 'LEARN_MORE' },
      },
    });

    const creativeResult = (await postWithRetry(
      `${BASE_URL}/${accountId}/adcreatives`,
      {
        params: {
          name: `${input.adName}_creative`,
          object_story_spec: objectStorySpec,
        },
        accessToken,
      },
    )) as { id: string };

    if (!creativeResult.id) {
      throw new Error(
        `Unexpected creative response: ${JSON.stringify(creativeResult)}`,
      );
    }
    adCreativeId = creativeResult.id;
  } catch (error) {
    if (error instanceof MetaDeployError) throw error;
    throw new MetaDeployError(
      `Ad creative creation failed: ${redactTokens(error instanceof Error ? error.message : String(error))}`,
      'ad_creative',
    );
  }

  // Step 3: Create ad
  let adId: string;
  try {
    const adResult = (await postWithRetry(
      `${BASE_URL}/${accountId}/ads`,
      {
        params: {
          name: input.adName,
          adset_id: input.adSetId,
          creative: JSON.stringify({ creative_id: adCreativeId }),
          status: paused ? 'PAUSED' : 'ACTIVE',
        },
        accessToken,
      },
    )) as { id: string };

    if (!adResult.id) {
      throw new Error(`Unexpected ad response: ${JSON.stringify(adResult)}`);
    }
    adId = adResult.id;
  } catch (error) {
    if (error instanceof MetaDeployError) throw error;
    throw new MetaDeployError(
      `Ad creation failed: ${redactTokens(error instanceof Error ? error.message : String(error))}`,
      'ad_create',
    );
  }

  // Step 4: Get preview URL (non-fatal)
  let previewUrl: string | null = null;
  try {
    const searchParams = new URLSearchParams({
      ad_format: 'MOBILE_FEED_STANDARD',
      access_token: accessToken,
    });
    const previewResponse = await fetch(
      `${BASE_URL}/${adId}/previews?${searchParams.toString()}`,
    );

    if (previewResponse.ok) {
      const previewData = (await previewResponse.json()) as {
        data?: Array<{ body?: string }>;
      };
      const iframeHtml = previewData.data?.[0]?.body;
      if (iframeHtml) {
        const srcMatch = iframeHtml.match(/src="([^"]+)"/);
        if (srcMatch?.[1]) {
          previewUrl = srcMatch[1].replace(/&amp;/g, '&');
        }
      }
    }
  } catch {
    // Non-fatal — preview URL is optional
  }

  return {
    adId,
    adCreativeId,
    imageHash,
    previewUrl,
  };
}

// ---------------------------------------------------------------------------
// List ad sets helper
// ---------------------------------------------------------------------------

export async function listAdSets(
  campaignId?: string,
): Promise<Array<{ id: string; name: string; status: string }>> {
  const env = getServerEnv();
  const accessToken = env.metaAccessToken;
  const accountId = env.metaAdAccountId.startsWith('act_')
    ? env.metaAdAccountId
    : `act_${env.metaAdAccountId}`;

  const params: Record<string, string> = {
    fields: 'id,name,status',
    limit: '200',
    access_token: accessToken,
  };

  if (campaignId) {
    params.filtering = JSON.stringify([
      { field: 'campaign.id', operator: 'EQUAL', value: campaignId },
    ]);
  }

  const url = `${BASE_URL}/${accountId}/adsets`;
  const searchParams = new URLSearchParams(params);
  const allAdSets: Array<{ id: string; name: string; status: string }> = [];

  let nextUrl: string | null = `${url}?${searchParams.toString()}`;

  while (nextUrl) {
    const response = await fetch(nextUrl);

    if (!response.ok) {
      const body = await response.text();
      throw new MetaDeployError(
        `Failed to list ad sets: ${response.status} ${sanitizeErrorBody(body)}`,
        'list_adsets',
        response.status,
      );
    }

    const result = (await response.json()) as {
      data: Array<{ id: string; name: string; status: string }>;
      paging?: { next?: string };
    };

    allAdSets.push(...result.data);
    nextUrl = result.paging?.next ?? null;
  }

  return allAdSets;
}
