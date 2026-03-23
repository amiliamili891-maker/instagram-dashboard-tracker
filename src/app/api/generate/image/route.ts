/**
 * POST /api/generate/image
 *
 * Generate an ad creative image via LaoZhang (Gemini) and upload to Supabase Storage.
 * Accepts either a pre-flattened text prompt or a structured NB2 JSON object.
 */

import { createServiceClient } from '@/lib/supabase/service';
import { requireAdminUser } from '@/lib/auth/guards';
import { flattenNb2Prompt, isNb2Json } from '@/lib/nb2/flatten';
import { NB2_ASPECT_RATIOS, NB2_RESOLUTIONS } from '@/lib/nb2/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 90; // LaoZhang can take up to 60s for 4K

// ---------------------------------------------------------------------------
// LaoZhang API caller with 1 retry on 5xx / timeout
// ---------------------------------------------------------------------------

const LAOZHANG_URL =
  'https://api.laozhang.ai/v1beta/models/gemini-3.1-flash-image-preview:generateContent';

async function callLaoZhang(
  prompt: string,
  aspectRatio: string,
  resolution: string,
  apiKey: string,
  attempt = 1,
): Promise<Record<string, unknown>> {
  try {
    const resp = await fetch(LAOZHANG_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ['IMAGE'],
          imageConfig: {
            aspectRatio,
            imageSize: resolution,
          },
        },
      }),
      signal: AbortSignal.timeout(80_000),
    });

    if (!resp.ok) {
      if (attempt === 1 && resp.status >= 500) {
        return callLaoZhang(prompt, aspectRatio, resolution, apiKey, 2);
      }
      const body = await resp.text().catch(() => '');
      throw new Error(
        `LaoZhang API error: ${resp.status} ${resp.statusText} — ${body}`,
      );
    }

    return (await resp.json()) as Record<string, unknown>;
  } catch (err: unknown) {
    const error = err as Error & { name?: string };
    if (
      attempt === 1 &&
      (error.name === 'TimeoutError' || error.name === 'AbortError')
    ) {
      return callLaoZhang(prompt, aspectRatio, resolution, apiKey, 2);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Base64 image extraction — supports Google native & OpenAI fallback formats
// ---------------------------------------------------------------------------

function extractBase64Image(
  json: Record<string, unknown>,
): { data: string; mimeType: string } | null {
  // Google native format: candidates[0].content.parts[0].inlineData.data
  try {
    const candidates = json.candidates as Array<Record<string, unknown>>;
    const content = candidates?.[0]?.content as Record<string, unknown>;
    const parts = content?.parts as Array<Record<string, unknown>>;
    const inlineData = parts?.[0]?.inlineData as Record<string, unknown>;
    if (typeof inlineData?.data === 'string' && inlineData.data.length > 0) {
      return {
        data: inlineData.data,
        mimeType: (inlineData.mimeType as string) || 'image/png',
      };
    }
  } catch {
    // fall through to OpenAI fallback
  }

  // OpenAI fallback: regex match from choices[0].message.content
  try {
    const choices = json.choices as Array<Record<string, unknown>>;
    const message = choices?.[0]?.message as Record<string, unknown>;
    const content = message?.content;
    if (typeof content === 'string') {
      const match = content.match(
        /data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)/,
      );
      if (match) {
        return { data: match[2], mimeType: `image/${match[1]}` };
      }
    }
  } catch {
    // fall through
  }

  return null;
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

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

  const { prompt, nb2_json, concept_name, aspect_ratio, resolution } = body as {
    prompt?: string;
    nb2_json?: unknown;
    concept_name?: string;
    aspect_ratio?: string;
    resolution?: string;
  };

  if (!concept_name || typeof concept_name !== 'string') {
    return Response.json(
      { error: 'concept_name is required' },
      { status: 400 },
    );
  }

  if (!prompt && !nb2_json) {
    return Response.json(
      { error: 'Either prompt or nb2_json is required' },
      { status: 400 },
    );
  }

  if (prompt && nb2_json) {
    return Response.json(
      { error: 'Provide either prompt or nb2_json, not both' },
      { status: 400 },
    );
  }

  // Resolve final prompt
  let finalPrompt: string;

  if (nb2_json) {
    if (!isNb2Json(nb2_json)) {
      return Response.json(
        { error: 'nb2_json does not match expected NB2 prompt shape' },
        { status: 400 },
      );
    }
    finalPrompt = flattenNb2Prompt(nb2_json);
  } else {
    finalPrompt = prompt as string;
  }

  // Validate aspect_ratio
  const ar = aspect_ratio ?? '9:16';
  if (
    !(NB2_ASPECT_RATIOS as readonly string[]).includes(ar)
  ) {
    return Response.json(
      { error: `Invalid aspect_ratio. Allowed: ${NB2_ASPECT_RATIOS.join(', ')}` },
      { status: 400 },
    );
  }

  // Validate resolution
  const res = resolution ?? '4K';
  if (
    !(NB2_RESOLUTIONS as readonly string[]).includes(res)
  ) {
    return Response.json(
      { error: `Invalid resolution. Allowed: ${NB2_RESOLUTIONS.join(', ')}` },
      { status: 400 },
    );
  }

  // 3. API key
  const apiKey = process.env.LAOZHANG_API_KEY;
  if (!apiKey) {
    console.error('LAOZHANG_API_KEY is not set in environment variables');
    return Response.json(
      { error: 'Image generation service is not configured (missing API key)' },
      { status: 500 },
    );
  }

  // 4. Call LaoZhang API
  const startMs = Date.now();
  let apiResponse: Record<string, unknown>;

  try {
    apiResponse = await callLaoZhang(finalPrompt, ar, res, apiKey);
  } catch (err: unknown) {
    const error = err as Error & { name?: string };
    console.error('LaoZhang API call failed:', error);

    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return Response.json(
        { error: 'Image generation timed out after retries' },
        { status: 504 },
      );
    }

    return Response.json(
      { error: `Image generation failed: ${error.message}` },
      { status: 502 },
    );
  }

  const durationMs = Date.now() - startMs;

  // 5. Extract base64 image
  const imageResult = extractBase64Image(apiResponse);
  if (!imageResult) {
    console.error(
      'Could not extract image from LaoZhang response:',
      JSON.stringify(apiResponse).slice(0, 500),
    );
    return Response.json(
      { error: 'No image data found in generation response' },
      { status: 500 },
    );
  }

  const imageBuffer = Buffer.from(imageResult.data, 'base64');

  // 6. Upload to Supabase Storage
  const supabase = createServiceClient();
  const storagePath = `generated/${concept_name}.png`;

  const { error: uploadError } = await supabase.storage
    .from('ad-creatives')
    .upload(storagePath, imageBuffer, {
      contentType: 'image/png',
      upsert: true,
    });

  if (uploadError) {
    console.error('Supabase storage upload failed:', uploadError);
    return Response.json(
      { error: `Storage upload failed: ${uploadError.message}` },
      { status: 500 },
    );
  }

  // 7. Generate signed URL (1 hour expiry)
  const { data: signedUrlData, error: signedUrlError } = await supabase.storage
    .from('ad-creatives')
    .createSignedUrl(storagePath, 3600);

  if (signedUrlError || !signedUrlData?.signedUrl) {
    console.error('Failed to generate signed URL:', signedUrlError);
    return Response.json(
      { error: 'Image uploaded but failed to generate signed URL' },
      { status: 500 },
    );
  }

  // 8. Success response
  return Response.json({
    url: signedUrlData.signedUrl,
    storage_path: storagePath,
    bytes: imageBuffer.length,
    duration_ms: durationMs,
  });
}
