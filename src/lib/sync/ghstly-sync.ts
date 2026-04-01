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
import { type SyncLogEntry } from './types';
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
  report_date: string;
  entity_level: 'campaign' | 'adset' | 'ad';
  entity_id: string;
  campaign_id: string | null;
  adset_id: string | null;
  ad_id: string | null;
  visits: number;
  chats: number;
  reveals: number;
  click_throughs: number;
  ghstly_conversions: number;
  sync_batch_id: string;
  join_status: 'joinable' | 'unjoinable';
  join_issue: string | null;
}

/** A session row ready for database upsert, with PII stripped */
export interface SessionRow {
  id: string;
  created_at_utc: string;
  started_at_utc: string;
  ended_at_utc: string | null;
  status: string;
  messages_count: number;
  brand: string;
  reached_reveal: boolean;
  clicked_through: boolean;
  converted: boolean;
  campaign_id: string;
  adset_id: string;
  ad_id: string;
  city: string;
  region: string;
  country: string;
  chat_type: string | null;
  chatter_name: string | null;
  sync_batch_id: string;
  join_status: 'joinable' | 'unjoinable';
  join_issue: string | null;
}

/** Sync log entry — re-exported from canonical shared types */
export type { SyncLogEntry } from './types';

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
  /** Return the most recent session created_at we have stored (ISO string), or null */
  getLatestSessionTimestamp?(): Promise<string | null>;
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

  // Determine entity level and ID from the available IDs
  const entityLevel: 'campaign' | 'adset' | 'ad' =
    row.ad_id ? 'ad' : row.adset_id ? 'adset' : 'campaign';
  const entityId = row.ad_id ?? row.adset_id ?? row.campaign_id ?? '';

  return {
    report_date: row.date,
    entity_level: entityLevel,
    entity_id: entityId,
    campaign_id: row.campaign_id,
    adset_id: row.adset_id,
    ad_id: row.ad_id,
    visits: row.visits,
    chats: row.chats,
    reveals: row.reveals,
    click_throughs: row.click_throughs,
    ghstly_conversions: row.conversions,
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
    id: session.session_id,
    created_at_utc: session.created_at,
    started_at_utc: session.started_at,
    ended_at_utc: session.ended_at,
    status: session.status,
    messages_count: session.messages_count,
    brand: session.brand,
    reached_reveal: session.reached_reveal,
    clicked_through: session.clicked_through,
    converted: session.converted,
    campaign_id: joinKeys.campaign_id,
    adset_id: joinKeys.adset_id,
    ad_id: joinKeys.ad_id,
    city: session.city,
    region: session.region,
    country: session.country,
    chat_type: session.chat_type ?? null,
    chatter_name: session.chatter_name ?? null,
    sync_batch_id: syncBatchId,
    join_status: classification.status,
    join_issue: classification.issue,
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
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// Sync Service
// ---------------------------------------------------------------------------

/**
 * Fetch all sessions by paginating through the /sessions endpoint.
 */
async function fetchAllSessions(
  client: GhstlyClient,
  filters?: { start_date?: string; finish_date?: string },
  pageSize = 100,
): Promise<GhstlySession[]> {
  const allSessions: GhstlySession[] = [];
  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const response = await client.fetchSessions({
      limit: pageSize,
      offset,
      start_date: filters?.start_date,
      finish_date: filters?.finish_date,
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
 * Uses watermark to only fetch sessions newer than what we already have.
 */
export async function syncGhstlyIncremental(
  client: GhstlyClient,
  persistence: GhstlyPersistence,
): Promise<GhstlySyncResult> {
  const syncBatchId = generateSyncBatchId();
  const today = getTodayLA();
  const yesterday = getDateDaysAgo(1);

  return executeSyncForDateRange(client, persistence, syncBatchId, yesterday, today, true);
}

/**
 * Backfill sync: fetches N days of stats and sessions (default 30).
 * Does NOT use watermark — fetches all sessions in the date range.
 */
export async function syncGhstlyBackfill(
  client: GhstlyClient,
  persistence: GhstlyPersistence,
  days = 30,
): Promise<GhstlySyncResult> {
  const syncBatchId = generateSyncBatchId();
  const today = getTodayLA();
  const startDate = getDateDaysAgo(days);

  return executeSyncForDateRange(client, persistence, syncBatchId, startDate, today, false);
}

/**
 * Core sync logic for a given date range. Idempotent via upserts.
 * When useWatermark=true, only fetches sessions newer than our latest stored session.
 */
async function executeSyncForDateRange(
  client: GhstlyClient,
  persistence: GhstlyPersistence,
  syncBatchId: string,
  dateFrom: string,
  dateTo: string,
  useWatermark = false,
): Promise<GhstlySyncResult> {
  const syncLogs: SyncLogEntry[] = [];
  const filteredSummaries = new Map<string, GhstlyStatsResponse['summary']>();

  // ---- Stage 1: Fetch and persist daily stats ----
  const statsStart = Date.now();
  let dailyStatsRows: DailyGhstlyStatsRow[] = [];

  try {
    const dailyResponse = await client.fetchStatsDaily({
      start_date: dateFrom,
      finish_date: dateTo,
    });

    const allRows = dailyResponse.items.map((row) =>
      transformDailyStatsRow(row, syncBatchId),
    );

    // Deduplicate: Postgres ON CONFLICT can't handle the same key twice in one batch.
    // Keep the last occurrence per (report_date, entity_level, entity_id).
    const deduped = new Map<string, DailyGhstlyStatsRow>();
    for (const row of allRows) {
      deduped.set(`${row.report_date}|${row.entity_level}|${row.entity_id}`, row);
    }
    dailyStatsRows = Array.from(deduped.values());

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

    const campaignResults = await Promise.all(
      Array.from(campaignIds).map(async (campaignId) => {
        const filtered = await client.fetchStats({ campaign_id: campaignId });
        return { campaignId, summary: filtered.summary };
      }),
    );
    for (const { campaignId, summary } of campaignResults) {
      filteredSummaries.set(`campaign:${campaignId}`, summary);
    }

    syncLogs.push(makeSyncLog(syncBatchId, 'stats_summaries', 'success', summaryStart, filteredSummaries.size, dateFrom));
  } catch (error) {
    // Non-fatal: summaries are supplementary
    syncLogs.push(makeSyncLog(syncBatchId, 'stats_summaries', 'error', summaryStart, 0, dateFrom, error));
  }

  // ---- Stage 3: Fetch and persist sessions ----
  // When useWatermark=true, only fetch sessions created after our latest stored one.
  // This avoids re-fetching hundreds of sessions we already have on every sync.
  const sessionsStart = Date.now();
  let sessionRows: SessionRow[] = [];
  let sessionDateFrom = dateFrom;

  try {
    if (useWatermark && persistence.getLatestSessionTimestamp) {
      const watermark = await persistence.getLatestSessionTimestamp();
      if (watermark) {
        // Use the watermark date (YYYY-MM-DD) as the start_date filter.
        // We still include that day to catch any sessions created on the same
        // day after our last sync — upsert handles duplicates safely.
        const watermarkDate = watermark.split('T')[0];
        if (watermarkDate > dateFrom) {
          sessionDateFrom = watermarkDate;
        }
      }
    }

    const sessions = await fetchAllSessions(client, {
      start_date: sessionDateFrom,
      finish_date: dateTo,
    });

    sessionRows = sessions.map((session) =>
      transformSession(session, syncBatchId),
    );

    await persistence.upsertSessions(sessionRows);

    syncLogs.push(makeSyncLog(syncBatchId, 'sessions', 'success', sessionsStart, sessionRows.length, sessionDateFrom));
  } catch (error) {
    syncLogs.push(makeSyncLog(syncBatchId, 'sessions', 'error', sessionsStart, 0, sessionDateFrom, error));
    throw error;
  }

  // ---- Persist sync logs (batched) ----
  await Promise.all(syncLogs.map((log) => persistence.insertSyncLog(log)));

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
