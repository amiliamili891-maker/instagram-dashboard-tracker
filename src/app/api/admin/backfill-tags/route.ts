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

  // Phase 1: Apply manual overrides (typically 1-2 ads, individual queries are fine)
  for (const ad of ads) {
    const override = overrides[ad.id];
    if (!override) continue;

    const tags: Record<string, string | null> = {};
    if (override.format_category) tags.format_category = override.format_category;
    if (override.emotional_trigger) tags.emotional_trigger = override.emotional_trigger;
    if (override.text_angle) tags.text_angle = override.text_angle;

    if (Object.keys(tags).length > 0) {
      await supabase.from('ads').update(tags).eq('id', ad.id);
      updated++;
      results.push({ id: ad.id, name: ad.name, tags: override, source: 'override' });
    }
  }

  // Phase 2: Batch inferred tag updates — group ads by identical tag combination
  const tagGroups = new Map<string, Array<{ id: string; name: string }>>();

  for (const ad of ads) {
    // Skip overridden ads (already handled above)
    if (overrides[ad.id]) continue;

    // Skip ads that already have all three tags
    if (ad.format_category && ad.emotional_trigger && ad.text_angle) {
      skipped++;
      continue;
    }

    const inferred = inferAttributesFromName(ad.name);

    const updates: Record<string, string> = {};
    if (!ad.format_category && inferred.format_category) updates.format_category = inferred.format_category;
    if (!ad.emotional_trigger && inferred.emotional_trigger) updates.emotional_trigger = inferred.emotional_trigger;
    if (!ad.text_angle && inferred.text_angle) updates.text_angle = inferred.text_angle;

    if (Object.keys(updates).length > 0) {
      const key = JSON.stringify(updates);
      const group = tagGroups.get(key) ?? [];
      group.push({ id: ad.id, name: ad.name });
      tagGroups.set(key, group);
    } else {
      skipped++;
    }
  }

  // Issue one UPDATE per unique tag combination (typically ~10-15 instead of ~81)
  for (const [tagsJson, groupAds] of tagGroups) {
    const tags = JSON.parse(tagsJson) as Record<string, string>;
    const ids = groupAds.map((a) => a.id);
    await supabase.from('ads').update(tags).in('id', ids);
    updated += groupAds.length;
    for (const ad of groupAds) {
      results.push({ id: ad.id, name: ad.name, tags, source: 'inferred' });
    }
  }

  return Response.json({
    updated,
    skipped,
    total: ads.length,
    results,
  });
}
