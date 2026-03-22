/**
 * Meta Ads sync service.
 *
 * Fetches campaign/adset/ad metadata and daily insights from the Meta Graph
 * API, transforms responses into database rows, and upserts into Supabase.
 *
 * Two code paths:
 *   - syncMetaIncremental(): current day + previous day
 *   - syncMetaBackfill(days): N-day backfill (default 30)
 *
 * Each sync run generates a sync_batch_id (uuid) and logs to sync_logs.
 * Upserts are idempotent: same sync twice yields the same row count and values.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { type SyncLogEntry } from './types';

import {
  type MetaAdRow,
  type MetaAdsetRow,
  type MetaCampaignRow,
  type MetaClient,
  type MetaDateRange,
  type MetaInsightRow,
  type MetaInsightLevel,
  buildBackfillDateRange,
  buildIncrementalDateRange,
  createMetaClient,
  parseMetaFloat,
  parseMetaNumber,
} from "@/lib/api/meta-client";

// ---------------------------------------------------------------------------
// Types for DB rows
// ---------------------------------------------------------------------------

export interface CampaignRow {
  id: string;
  account_id: string;
  name: string;
  status: string | null;
  effective_status: string | null;
  objective: string | null;
  daily_budget: number | null;
  lifetime_budget: number | null;
  sync_batch_id: string;
  source_payload: Record<string, unknown>;
}

export interface AdsetRow {
  id: string;
  campaign_id: string;
  name: string;
  status: string | null;
  effective_status: string | null;
  optimization_goal: string | null;
  billing_event: string | null;
  sync_batch_id: string;
  source_payload: Record<string, unknown>;
}

export interface AdRow {
  id: string;
  campaign_id: string;
  adset_id: string;
  name: string;
  status: string | null;
  effective_status: string | null;
  creative_thumbnail_url: string | null;
  creative_image_url: string | null;
  sync_batch_id: string;
  source_payload: Record<string, unknown>;
}

export interface DailyMetaStatsRow {
  report_date: string;
  entity_level: MetaInsightLevel;
  entity_id: string;
  campaign_id: string;
  adset_id: string | null;
  ad_id: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  unique_clicks: number | null;
  cpc: number | null;
  cpm: number | null;
  ctr: number | null;
  sync_batch_id: string;
  source_payload: Record<string, unknown>;
}

/** Sync log entry — re-exported from canonical shared types */
export type { SyncLogEntry } from './types';

// ---------------------------------------------------------------------------
// Transformation functions (exported for testing)
// ---------------------------------------------------------------------------

export function transformCampaign(
  raw: MetaCampaignRow,
  accountId: string,
  syncBatchId: string,
): CampaignRow {
  return {
    id: raw.id,
    account_id: accountId,
    name: raw.name,
    status: raw.status ?? null,
    effective_status: raw.effective_status ?? null,
    objective: raw.objective ?? null,
    daily_budget: parseMetaFloat(raw.daily_budget),
    lifetime_budget: parseMetaFloat(raw.lifetime_budget),
    sync_batch_id: syncBatchId,
    source_payload: raw as unknown as Record<string, unknown>,
  };
}

export function transformAdset(
  raw: MetaAdsetRow,
  syncBatchId: string,
): AdsetRow {
  return {
    id: raw.id,
    campaign_id: raw.campaign_id,
    name: raw.name,
    status: raw.status ?? null,
    effective_status: raw.effective_status ?? null,
    optimization_goal: raw.optimization_goal ?? null,
    billing_event: raw.billing_event ?? null,
    sync_batch_id: syncBatchId,
    source_payload: raw as unknown as Record<string, unknown>,
  };
}

export function transformAd(
  raw: MetaAdRow,
  syncBatchId: string,
): AdRow {
  return {
    id: raw.id,
    campaign_id: raw.campaign_id,
    adset_id: raw.adset_id,
    name: raw.name,
    status: raw.status ?? null,
    effective_status: raw.effective_status ?? null,
    creative_thumbnail_url: raw.creative?.thumbnail_url ?? null,
    creative_image_url: raw.creative?.image_url ?? null,
    sync_batch_id: syncBatchId,
    source_payload: raw as unknown as Record<string, unknown>,
  };
}

export function transformInsight(
  raw: MetaInsightRow,
  level: MetaInsightLevel,
  syncBatchId: string,
): DailyMetaStatsRow {
  // Entity ID depends on the grain level
  let entityId: string;
  let adsetId: string | null = null;
  let adId: string | null = null;

  if (level === "ad") {
    entityId = raw.ad_id!;
    adsetId = raw.adset_id ?? null;
    adId = raw.ad_id ?? null;
  } else if (level === "adset") {
    entityId = raw.adset_id!;
    adsetId = raw.adset_id ?? null;
  } else {
    entityId = raw.campaign_id;
  }

  return {
    report_date: raw.date_start,
    entity_level: level,
    entity_id: entityId,
    campaign_id: raw.campaign_id,
    adset_id: adsetId,
    ad_id: adId,
    spend: parseMetaNumber(raw.spend),
    impressions: parseMetaNumber(raw.impressions),
    clicks: parseMetaNumber(raw.clicks),
    unique_clicks: raw.unique_clicks !== undefined
      ? parseMetaNumber(raw.unique_clicks)
      : null,
    cpc: parseMetaFloat(raw.cpc),
    cpm: parseMetaFloat(raw.cpm),
    ctr: parseMetaFloat(raw.ctr),
    sync_batch_id: syncBatchId,
    source_payload: raw as unknown as Record<string, unknown>,
  };
}

/**
 * Build the natural key for a daily_meta_stats row.
 * Used for upsert conflict resolution.
 */
export function buildNaturalKey(
  reportDate: string,
  entityLevel: string,
  entityId: string,
): string {
  return `${reportDate}:${entityLevel}:${entityId}`;
}

// ---------------------------------------------------------------------------
// Supabase service-role client factory
// ---------------------------------------------------------------------------

export function createServiceClient(
  supabaseUrl: string,
  serviceRoleKey: string,
): SupabaseClient {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ---------------------------------------------------------------------------
// Sync orchestration
// ---------------------------------------------------------------------------

export interface MetaSyncConfig {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  metaAccessToken: string;
  metaAdAccountId: string;
}

export interface MetaSyncResult {
  syncBatchId: string;
  campaignsUpserted: number;
  adsetsUpserted: number;
  adsUpserted: number;
  insightsUpserted: number;
  dateRange: MetaDateRange;
  durationMs: number;
}

/**
 * Run an incremental Meta sync: current day + previous day.
 */
export async function syncMetaIncremental(
  config: MetaSyncConfig,
  today?: string,
): Promise<MetaSyncResult> {
  const dateRange = buildIncrementalDateRange(today);
  return runMetaSync(config, dateRange, "scheduled", "system");
}

/**
 * Run a Meta backfill sync for N days (default 30).
 */
export async function syncMetaBackfill(
  config: MetaSyncConfig,
  days: number = 30,
  endDate?: string,
): Promise<MetaSyncResult> {
  const dateRange = buildBackfillDateRange(days, endDate);
  return runMetaSync(config, dateRange, "backfill", "system");
}

async function runMetaSync(
  config: MetaSyncConfig,
  dateRange: MetaDateRange,
  syncType: string,
  triggeredBy: string,
): Promise<MetaSyncResult> {
  const startTime = Date.now();
  const syncBatchId = crypto.randomUUID();

  const supabase = createServiceClient(
    config.supabaseUrl,
    config.supabaseServiceRoleKey,
  );

  const metaClient = createMetaClient({
    accessToken: config.metaAccessToken,
    adAccountId: config.metaAdAccountId,
  });

  // Log sync start
  await insertSyncLog(supabase, {
    sync_batch_id: syncBatchId,
    source: "meta",
    stage: "orchestrate",
    status: "running",
    started_at: new Date().toISOString(),
    sync_type: syncType,
    triggered_by: triggeredBy,
    context: { dateRange },
  });

  try {
    // 1. Fetch all metadata
    const [campaigns, adsets, ads] = await Promise.all([
      metaClient.fetchCampaigns(),
      metaClient.fetchAdsets(),
      metaClient.fetchAds(),
    ]);

    // 2. Fetch daily insights at all three grain levels
    const [campaignInsights, adsetInsights, adInsights] = await Promise.all([
      metaClient.fetchDailyInsights("campaign", dateRange),
      metaClient.fetchDailyInsights("adset", dateRange),
      metaClient.fetchDailyInsights("ad", dateRange),
    ]);

    // 3. Transform
    const accountId = config.metaAdAccountId;
    const campaignRows = campaigns.map((c) =>
      transformCampaign(c, accountId, syncBatchId),
    );
    const adsetRows = adsets.map((a) => transformAdset(a, syncBatchId));
    const adRows = ads.map((a) => transformAd(a, syncBatchId));

    const insightRows = [
      ...campaignInsights.map((i) => transformInsight(i, "campaign", syncBatchId)),
      ...adsetInsights.map((i) => transformInsight(i, "adset", syncBatchId)),
      ...adInsights.map((i) => transformInsight(i, "ad", syncBatchId)),
    ];

    // 4. Upsert metadata (campaigns first due to FK constraints)
    const campaignsUpserted = await upsertCampaigns(supabase, campaignRows);
    const adsetsUpserted = await upsertAdsets(supabase, adsetRows);
    const adsUpserted = await upsertAds(supabase, adRows);

    // 4b. Cache creative thumbnails to Supabase Storage
    const thumbnailsCached = await cacheCreativeThumbnails(supabase, ads);

    // 5. Upsert insights
    const insightsUpserted = await upsertDailyMetaStats(supabase, insightRows);

    const durationMs = Date.now() - startTime;
    const totalRecords =
      campaignsUpserted + adsetsUpserted + adsUpserted + insightsUpserted;

    // Log sync success
    await insertSyncLog(supabase, {
      sync_batch_id: syncBatchId,
      source: "meta",
      stage: "persist",
      status: "success",
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: durationMs,
      records_synced: totalRecords,
      watermark_date: dateRange.until,
      sync_type: syncType,
      triggered_by: triggeredBy,
      context: {
        dateRange,
        campaignsUpserted,
        adsetsUpserted,
        adsUpserted,
        insightsUpserted,
        thumbnailsCached,
      },
    });

    return {
      syncBatchId,
      campaignsUpserted,
      adsetsUpserted,
      adsUpserted,
      insightsUpserted,
      dateRange,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    const errorClass =
      error instanceof Error ? error.constructor.name : "UnknownError";

    // Log sync failure
    await insertSyncLog(supabase, {
      sync_batch_id: syncBatchId,
      source: "meta",
      stage: "persist",
      status: "failed",
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: durationMs,
      error_class: errorClass,
      error_message: errorMessage,
      sync_type: syncType,
      triggered_by: triggeredBy,
      context: { dateRange },
    });

    throw error;
  }
}

// ---------------------------------------------------------------------------
// Upsert helpers
// ---------------------------------------------------------------------------

async function upsertCampaigns(
  supabase: SupabaseClient,
  rows: CampaignRow[],
): Promise<number> {
  if (rows.length === 0) return 0;

  const { error } = await supabase.from("campaigns").upsert(rows, {
    onConflict: "id",
    ignoreDuplicates: false,
  });

  if (error) throw new Error(`Failed to upsert campaigns: ${error.message}`);
  return rows.length;
}

async function upsertAdsets(
  supabase: SupabaseClient,
  rows: AdsetRow[],
): Promise<number> {
  if (rows.length === 0) return 0;

  const { error } = await supabase.from("adsets").upsert(rows, {
    onConflict: "id",
    ignoreDuplicates: false,
  });

  if (error) throw new Error(`Failed to upsert adsets: ${error.message}`);
  return rows.length;
}

async function upsertAds(
  supabase: SupabaseClient,
  rows: AdRow[],
): Promise<number> {
  if (rows.length === 0) return 0;

  const { error } = await supabase.from("ads").upsert(rows, {
    onConflict: "id",
    ignoreDuplicates: false,
  });

  if (error) throw new Error(`Failed to upsert ads: ${error.message}`);
  return rows.length;
}

/**
 * Download and cache ad creative thumbnails in Supabase Storage.
 * Non-fatal: failures are logged but don't break the sync.
 */
const THUMBNAIL_CONCURRENCY = 5;

async function cacheSingleThumbnail(
  supabase: SupabaseClient,
  ad: MetaAdRow,
): Promise<boolean> {
  const thumbnailUrl = ad.creative?.thumbnail_url;
  if (!thumbnailUrl) return false;

  const storagePath = `${ad.id}/thumbnail.jpg`;

  try {
    const response = await fetch(thumbnailUrl);
    if (!response.ok) return false;

    const contentType = response.headers.get("content-type") ?? "image/jpeg";
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { error: uploadError } = await supabase.storage
      .from("ad-creatives")
      .upload(storagePath, buffer, { contentType, upsert: true });

    if (uploadError) {
      console.error(`Failed to cache thumbnail for ad ${ad.id}:`, uploadError.message);
      return false;
    }

    const { error: updateError } = await supabase
      .from("ads")
      .update({ creative_storage_path: storagePath })
      .eq("id", ad.id);

    if (updateError) {
      console.error(`Failed to update storage path for ad ${ad.id}:`, updateError.message);
      return false;
    }

    return true;
  } catch (err) {
    console.error(`Thumbnail cache error for ad ${ad.id}:`, err);
    return false;
  }
}

async function cacheSingleFullImage(
  supabase: SupabaseClient,
  ad: MetaAdRow,
): Promise<boolean> {
  const imageUrl = ad.creative?.image_url;
  if (!imageUrl) return false;

  const storagePath = `${ad.id}/full.jpg`;

  try {
    const response = await fetch(imageUrl);
    if (!response.ok) return false;

    const contentType = response.headers.get("content-type") ?? "image/jpeg";
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { error: uploadError } = await supabase.storage
      .from("ad-creatives")
      .upload(storagePath, buffer, { contentType, upsert: true });

    if (uploadError) {
      console.error(`Failed to cache full image for ad ${ad.id}:`, uploadError.message);
      return false;
    }

    const { error: updateError } = await supabase
      .from("ads")
      .update({ creative_full_path: storagePath })
      .eq("id", ad.id);

    if (updateError) {
      console.error(`Failed to update full image path for ad ${ad.id}:`, updateError.message);
      return false;
    }

    return true;
  } catch (err) {
    console.error(`Full image cache error for ad ${ad.id}:`, err);
    return false;
  }
}

async function cacheCreativeThumbnails(
  supabase: SupabaseClient,
  ads: MetaAdRow[],
): Promise<number> {
  const adsWithThumbnails = ads.filter((a) => a.creative?.thumbnail_url);

  // Skip ads that already have a cached thumbnail (saves 5-10s per incremental sync)
  const adIds = adsWithThumbnails.map((a) => a.id);
  const alreadyCached = new Set<string>();
  if (adIds.length > 0) {
    const { data } = await supabase
      .from("ads")
      .select("id")
      .in("id", adIds)
      .not("creative_storage_path", "is", null);
    if (data) {
      for (const row of data) alreadyCached.add(row.id);
    }
  }
  const uncachedThumbnails = adsWithThumbnails.filter((a) => !alreadyCached.has(a.id));

  let cached = 0;

  // Process in batches of THUMBNAIL_CONCURRENCY for parallel downloads
  for (let i = 0; i < uncachedThumbnails.length; i += THUMBNAIL_CONCURRENCY) {
    const batch = uncachedThumbnails.slice(i, i + THUMBNAIL_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((ad) => cacheSingleThumbnail(supabase, ad)),
    );
    cached += results.filter((r) => r.status === "fulfilled" && r.value).length;
  }

  // Also cache full-size images where available, skip already-cached
  const adsWithFullImages = ads.filter((a) => a.creative?.image_url);
  const fullImageIds = adsWithFullImages.map((a) => a.id);
  const alreadyCachedFull = new Set<string>();
  if (fullImageIds.length > 0) {
    const { data } = await supabase
      .from("ads")
      .select("id")
      .in("id", fullImageIds)
      .not("creative_full_path", "is", null);
    if (data) {
      for (const row of data) alreadyCachedFull.add(row.id);
    }
  }
  const uncachedFullImages = adsWithFullImages.filter((a) => !alreadyCachedFull.has(a.id));

  for (let i = 0; i < uncachedFullImages.length; i += THUMBNAIL_CONCURRENCY) {
    const batch = uncachedFullImages.slice(i, i + THUMBNAIL_CONCURRENCY);
    await Promise.allSettled(
      batch.map((ad) => cacheSingleFullImage(supabase, ad)),
    );
  }

  return cached;
}

async function upsertDailyMetaStats(
  supabase: SupabaseClient,
  rows: DailyMetaStatsRow[],
): Promise<number> {
  if (rows.length === 0) return 0;

  // Supabase upsert uses the unique index on (report_date, entity_level, entity_id)
  // We batch in chunks of 500 to avoid request size limits
  const BATCH_SIZE = 500;
  let totalUpserted = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from("daily_meta_stats")
      .upsert(batch, {
        onConflict: "report_date,entity_level,entity_id",
        ignoreDuplicates: false,
      });

    if (error) {
      throw new Error(`Failed to upsert daily_meta_stats: ${error.message}`);
    }
    totalUpserted += batch.length;
  }

  return totalUpserted;
}

// ---------------------------------------------------------------------------
// Sync log helper
// ---------------------------------------------------------------------------

async function insertSyncLog(
  supabase: SupabaseClient,
  entry: SyncLogEntry,
): Promise<void> {
  const { error } = await supabase.from("sync_logs").insert(entry);
  if (error) {
    // Log errors are non-fatal — don't throw, but warn
    console.error("Failed to insert sync_log:", error.message);
  }
}
