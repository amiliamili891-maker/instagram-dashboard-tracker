/**
 * POST /api/admin/backfill-tags
 *
 * Backfill creative attribute tags on all ads that don't have them.
 * Uses name-based inference to tag ads with format_category, emotional_trigger,
 * and text_angle. Only updates rows where ALL three columns are null.
 *
 * Supports manual override via request body:
 *   { overrides: { "ad_id_123": { format_category: "ghostpin", ... } } }
 *
 * Admin-only. Idempotent.
 */

import { createServiceClient } from '@/lib/supabase/service';
import { requireAdminUser } from '@/lib/auth/guards';
import {
  inferAttributesFromName,
  FORMAT_CATEGORIES,
  EMOTIONAL_TRIGGERS,
  TEXT_ANGLES,
  type FormatCategory,
  type EmotionalTrigger,
  type TextAngle,
} from '@/lib/creative-attributes';

export const dynamic = 'force-dynamic';

interface OverrideEntry {
  format_category?: FormatCategory;
  emotional_trigger?: EmotionalTrigger;
  text_angle?: TextAngle;
}

export async function POST(request: Request) {
  try {
    await requireAdminUser();
  } catch {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let overrides: Record<string, OverrideEntry> = {};
  try {
    const body = await request.json();
    if (body.overrides && typeof body.overrides === 'object') {
      overrides = body.overrides;
    }
  } catch {
    // No body or invalid JSON — proceed without overrides
  }

  // Validate override values
  for (const [adId, entry] of Object.entries(overrides)) {
    if (entry.format_category && !FORMAT_CATEGORIES.includes(entry.format_category)) {
      return Response.json(
        { error: `Invalid format_category "${entry.format_category}" for ad ${adId}` },
        { status: 400 },
      );
    }
    if (entry.emotional_trigger && !EMOTIONAL_TRIGGERS.includes(entry.emotional_trigger)) {
      return Response.json(
        { error: `Invalid emotional_trigger "${entry.emotional_trigger}" for ad ${adId}` },
        { status: 400 },
      );
    }
    if (entry.text_angle && !TEXT_ANGLES.includes(entry.text_angle)) {
      return Response.json(
        { error: `Invalid text_angle "${entry.text_angle}" for ad ${adId}` },
        { status: 400 },
      );
    }
  }

  const supabase = createServiceClient();

  // Fetch all ads
  const { data: ads, error } = await supabase
    .from('ads')
    .select('id, name, format_category, emotional_trigger, text_angle');

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  if (!ads || ads.length === 0) {
    return Response.json({ updated: 0, skipped: 0, message: 'No ads found' });
  }

  let updated = 0;
  let skipped = 0;
  const results: Array<{ id: string; name: string; tags: OverrideEntry; source: 'override' | 'inferred' }> = [];

  for (const ad of ads) {
    // Check if this ad has a manual override
    const override = overrides[ad.id];

    if (override) {
      // Apply manual override — always overwrite
      const tags: Record<string, string | null> = {};
      if (override.format_category) tags.format_category = override.format_category;
      if (override.emotional_trigger) tags.emotional_trigger = override.emotional_trigger;
      if (override.text_angle) tags.text_angle = override.text_angle;

      if (Object.keys(tags).length > 0) {
        await supabase.from('ads').update(tags).eq('id', ad.id);
        updated++;
        results.push({ id: ad.id, name: ad.name, tags: override, source: 'override' });
      }
      continue;
    }

    // Skip ads that already have all three tags
    if (ad.format_category && ad.emotional_trigger && ad.text_angle) {
      skipped++;
      continue;
    }

    // Infer from name
    const inferred = inferAttributesFromName(ad.name);

    // Only update columns that are currently null AND have an inferred value
    const updates: Record<string, string> = {};
    if (!ad.format_category && inferred.format_category) updates.format_category = inferred.format_category;
    if (!ad.emotional_trigger && inferred.emotional_trigger) updates.emotional_trigger = inferred.emotional_trigger;
    if (!ad.text_angle && inferred.text_angle) updates.text_angle = inferred.text_angle;

    if (Object.keys(updates).length > 0) {
      await supabase.from('ads').update(updates).eq('id', ad.id);
      updated++;
      results.push({ id: ad.id, name: ad.name, tags: updates, source: 'inferred' });
    } else {
      skipped++;
    }
  }

  return Response.json({
    updated,
    skipped,
    total: ads.length,
    results,
  });
}
