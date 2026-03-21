/**
 * Ghstly Sync Service
 *
 * Ingests data from Ghstly Partner API into local database tables:
 *   - daily_ghstly_stats (from /stats/daily)
 *   - sessions (from /sessions)
 *
 * Key behaviors:
 *   - Field mapping: sessions use campaign->campaign_id, keyword->adset_id, creative->ad_id
 *   - sessions.ad_id is IGNORED for joins
 *   - Joinability classification on every row
 *   - PII stripping: ip_address and user_agent are never persisted
 *   - Exact campaign/adset range totals come from filtered /stats summary
 *   - Idempotent upserts keyed on natural keys
 *   - Each row stores sync_batch_id, join_status, join_issue
 */

import type {
  GhstlyStatsDailyRow,
  GhstlySession,
  GhstlyStatsResponse,
  JoinClassification,
} from '@/lib/contracts/data-contract';
import {
  normalizeSessionJoinKeys,
  classifyJoinability,
} from '@/lib/contracts/data-contract';
import type { GhstlyClient } from '@/lib/api/ghstly-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A daily stats row ready for database upsert */
export interface DailyGhstlyStatsRow {
  date: string;
  campaign_id: string | null;
  adset_id: string | null;
  ad_id: string | null;
  visits: number;
  chats: number;
  reveals: number;
  click_throughs: number;
  conversions: number;
  sync_batch_id: string;
  join_status: 'joinable' | 'unjoinable';
  join_issue: string | null;
}

/** A session row ready for database upsert, with PII stripped */
export interface SessionRow {
  session_id: string;
  created_at: string;
  started_at: string;
  ended_at: string | null;
  status: string;
  messages_count: number;
  brand: string;
  brand_slug: string;
  phase: string | null;
  reached_reveal: boolean;
  clicked_through: boolean;
  converted: boolean;
  conversion_status: string;
  converted_at: string | null;
  reveal_platform: string | null;
  reveal_username: string | null;
  source: string;
  medium: string;
  /** Canonical join key: mapped from session.campaign */
  campaign_id: string;
  /** Canonical join key: mapped from session.keyword */
  adset_id: string;
  /** Canonical join key: mapped from session.creative */
  ad_id: string;
  city: string;
  region: string;
  country: string;
  lead_age: string | null;
  lead_gender: string | null;
  lead_name: string | null;
  photos_sent: number;
  voice_messages_sent: number;
  sync_batch_id: string;
  join_status: 'joinable' | 'unjoinable';
  join_issue: string | null;
  // NOTE: ip_address and user_agent are intentionally ABSENT
}

/** Sync log entry */
export interface SyncLogEntry {
  sync_batch_id: string;
  source: 'ghstly';
  stage: string;
  status: 'success' | 'error';
  started_at: string;
  completed_at: string;
  duration_ms: number;
  records_synced: number;
  watermark_date: string | null;
  error_class: string | null;
  error_message: string | null;
}

/** Result of a sync operation */
export interface GhstlySyncResult {
  syncBatchId: string;
  dailyStatsRows: DailyGhstlyStatsRow[];
  sessionRows: SessionRow[];
  syncLogs: SyncLogEntry[];
  /** Filtered stats summaries keyed by filter description */
  filteredSummaries: Map<string, GhstlyStatsResponse['summary']>;
}

/** Persistence interface — allows dependency injection for testing */
export interface GhstlyPersistence {
  upsertDailyGhstlyStats(rows: DailyGhstlyStatsRow[]): Promise<void>;
  upsertSessions(rows: SessionRow[]): Promise<void>;
  insertSyncLog(entry: SyncLogEntry): Promise<void>;
}

// ---------------------------------------------------------------------------
// Transformation Functions (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Transform a Ghstly daily stats row into a database-ready row.
 * Classifies joinability and attaches sync lineage.
 */
export function transformDailyStatsRow(
  row: GhstlyStatsDailyRow,
  syncBatchId: string,
): DailyGhstlyStatsRow {
  const classification: JoinClassification = classifyJoinability({
    campaign_id: row.campaign_id,
    adset_id: row.adset_id,
    ad_id: row.ad_id,
  });

  return {
    date: row.date,
    campaign_id: row.campaign_id,
    adset_id: row.adset_id,
    ad_id: row.ad_id,
    visits: row.visits,
    chats: row.chats,
    reveals: row.reveals,
    click_throughs: row.click_throughs,
    conversions: row.conversions,
    sync_batch_id: syncBatchId,
    join_status: classification.status,
    join_issue: classification.issue,
  };
}

/**
 * Transform a Ghstly session into a database-ready row.
 * - Maps UTM fields to canonical join keys using normalizeSessionJoinKeys
 * - Strips PII (ip_address, user_agent)
 * - Classifies joinability
 * - Attaches sync lineage
 */
export function transformSession(
  session: GhstlySession,
  syncBatchId: string,
): SessionRow {
  const joinKeys = normalizeSessionJoinKeys(session);

  const classification: JoinClassification = classifyJoinability({
    campaign_id: joinKeys.campaign_id || null,
    adset_id: joinKeys.adset_id || null,
    ad_id: joinKeys.ad_id || null,
    source: session.source,
  });

  return {
    session_id: session.session_id,
    created_at: session.created_at,
    started_at: session.started_at,
    ended_at: session.ended_at,
    status: session.status,
    messages_count: session.messages_count,
    brand: session.brand,
    brand_slug: session.brand_slug,
    phase: session.phase,
    reached_reveal: session.reached_reveal,
    clicked_through: session.clicked_through,
    converted: session.converted,
    conversion_status: session.conversion_status,
    converted_at: session.converted_at,
    reveal_platform: session.reveal_platform,
    reveal_username: session.reveal_username,
    source: session.source,
    medium: session.medium,
    campaign_id: joinKeys.campaign_id,
    adset_id: joinKeys.adset_id,
    ad_id: joinKeys.ad_id,
    city: session.city,
    region: session.region,
    country: session.country,
    lead_age: session.lead_age,
    lead_gender: session.lead_gender,
    lead_name: session.lead_name,
    photos_sent: session.photos_sent,
    voice_messages_sent: session.voice_messages_sent,
    sync_batch_id: syncBatchId,
    join_status: classification.status,
    join_issue: classification.issue,
    // ip_address and user_agent are intentionally NOT included
  };
}

// ---------------------------------------------------------------------------
// Date Helpers
// ---------------------------------------------------------------------------

/**
 * Get ISO date string for N days ago in America/Los_Angeles timezone.
 */
function getDateDaysAgo(days: number): string {
  const now = new Date();
  const laDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  laDate.setDate(laDate.getDate() - days);
  return laDate.toISOString().slice(0, 10);
}

/**
 * Get today's ISO date string in America/Los_Angeles timezone.
 */
function getTodayLA(): string {
  return getDateDaysAgo(0);
}

/**
 * Generate a unique sync batch ID.
 */
export function generateSyncBatchId(): string {
  const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const random = Math.random().toString(36).slice(2, 8);
  return `ghstly_${timestamp}_${random}`;
}

// ---------------------------------------------------------------------------
// Sync Service
// ---------------------------------------------------------------------------

/**
 * Fetch all sessions by paginating through the /sessions endpoint.
 */
async function fetchAllSessions(
  client: GhstlyClient,
  filters?: { date_from?: string; date_to?: string },
  pageSize = 100,
): Promise<GhstlySession[]> {
  const allSessions: GhstlySession[] = [];
  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const response = await client.fetchSessions({
      limit: pageSize,
      offset,
      date_from: filters?.date_from,
      date_to: filters?.date_to,
    });

    total = response.total;
    allSessions.push(...response.items);
    offset += response.items.length;

    // Safety: stop if no items returned to prevent infinite loop
    if (response.items.length === 0) break;
  }

  return allSessions;
}

/**
 * Incremental sync: fetches current day + previous day stats and sessions.
 */
export async function syncGhstlyIncremental(
  client: GhstlyClient,
  persistence: GhstlyPersistence,
): Promise<GhstlySyncResult> {
  const syncBatchId = generateSyncBatchId();
  const today = getTodayLA();
  const yesterday = getDateDaysAgo(1);

  return executeSyncForDateRange(client, persistence, syncBatchId, yesterday, today);
}

/**
 * Backfill sync: fetches N days of stats and sessions (default 30).
 */
export async function syncGhstlyBackfill(
  client: GhstlyClient,
  persistence: GhstlyPersistence,
  days = 30,
): Promise<GhstlySyncResult> {
  const syncBatchId = generateSyncBatchId();
  const today = getTodayLA();
  const startDate = getDateDaysAgo(days);

  return executeSyncForDateRange(client, persistence, syncBatchId, startDate, today);
}

/**
 * Core sync logic for a given date range. Idempotent via upserts.
 */
async function executeSyncForDateRange(
  client: GhstlyClient,
  persistence: GhstlyPersistence,
  syncBatchId: string,
  dateFrom: string,
  dateTo: string,
): Promise<GhstlySyncResult> {
  const syncLogs: SyncLogEntry[] = [];
  const filteredSummaries = new Map<string, GhstlyStatsResponse['summary']>();

  // ---- Stage 1: Fetch and persist daily stats ----
  const statsStart = Date.now();
  let dailyStatsRows: DailyGhstlyStatsRow[] = [];

  try {
    const dailyResponse = await client.fetchStatsDaily({
      date_from: dateFrom,
      date_to: dateTo,
    });

    dailyStatsRows = dailyResponse.items.map((row) =>
      transformDailyStatsRow(row, syncBatchId),
    );

    await persistence.upsertDailyGhstlyStats(dailyStatsRows);

    syncLogs.push(makeSyncLog(syncBatchId, 'daily_stats', 'success', statsStart, dailyStatsRows.length, dateFrom));
  } catch (error) {
    syncLogs.push(makeSyncLog(syncBatchId, 'daily_stats', 'error', statsStart, 0, dateFrom, error));
    // Re-throw so caller knows sync failed
    throw error;
  }

  // ---- Stage 2: Fetch filtered /stats summaries for exact campaign/adset totals ----
  const summaryStart = Date.now();
  try {
    // Get the overall summary for the date range
    const overallStats = await client.fetchStats();
    filteredSummaries.set('overall', overallStats.summary);

    // Extract unique campaign_ids from daily stats for filtered summary fetches
    const campaignIds = new Set(
      dailyStatsRows
        .filter((r) => r.campaign_id && r.join_status === 'joinable')
        .map((r) => r.campaign_id!),
    );

    for (const campaignId of campaignIds) {
      const filtered = await client.fetchStats({ campaign_id: campaignId });
      filteredSummaries.set(`campaign:${campaignId}`, filtered.summary);
    }

    syncLogs.push(makeSyncLog(syncBatchId, 'stats_summaries', 'success', summaryStart, filteredSummaries.size, dateFrom));
  } catch (error) {
    // Non-fatal: summaries are supplementary
    syncLogs.push(makeSyncLog(syncBatchId, 'stats_summaries', 'error', summaryStart, 0, dateFrom, error));
  }

  // ---- Stage 3: Fetch and persist sessions ----
  const sessionsStart = Date.now();
  let sessionRows: SessionRow[] = [];

  try {
    const sessions = await fetchAllSessions(client, {
      date_from: dateFrom,
      date_to: dateTo,
    });

    sessionRows = sessions.map((session) =>
      transformSession(session, syncBatchId),
    );

    await persistence.upsertSessions(sessionRows);

    syncLogs.push(makeSyncLog(syncBatchId, 'sessions', 'success', sessionsStart, sessionRows.length, dateFrom));
  } catch (error) {
    syncLogs.push(makeSyncLog(syncBatchId, 'sessions', 'error', sessionsStart, 0, dateFrom, error));
    throw error;
  }

  // ---- Persist sync logs ----
  for (const log of syncLogs) {
    await persistence.insertSyncLog(log);
  }

  return {
    syncBatchId,
    dailyStatsRows,
    sessionRows,
    syncLogs,
    filteredSummaries,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSyncLog(
  syncBatchId: string,
  stage: string,
  status: 'success' | 'error',
  startTime: number,
  recordsSynced: number,
  watermarkDate: string | null,
  error?: unknown,
): SyncLogEntry {
  const now = Date.now();
  return {
    sync_batch_id: syncBatchId,
    source: 'ghstly',
    stage,
    status,
    started_at: new Date(startTime).toISOString(),
    completed_at: new Date(now).toISOString(),
    duration_ms: now - startTime,
    records_synced: recordsSynced,
    watermark_date: watermarkDate,
    error_class: error instanceof Error ? error.constructor.name : error ? 'UnknownError' : null,
    error_message: error instanceof Error ? error.message : error ? String(error) : null,
  };
}
