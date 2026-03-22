/**
 * Meta Ads Graph API v21.0 client.
 *
 * Fetches campaign, adset, and ad metadata plus daily insights at all three
 * grain levels. Handles cursor-based pagination and retry on rate-limit errors.
 *
 * All numeric IDs are stored as strings (19-digit safe).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Raw insight row from Meta — all numeric values arrive as strings. */
export interface MetaInsightRow {
  ad_id?: string;
  ad_name?: string;
  adset_id?: string;
  adset_name?: string;
  campaign_id: string;
  campaign_name: string;
  impressions: string;
  clicks: string;
  unique_clicks?: string;
  ctr: string;
  cpc: string;
  cpm: string;
  spend: string;
  cost_per_unique_click?: string;
  date_start: string;
  date_stop: string;
}

export interface MetaCampaignRow {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  objective: string;
  daily_budget?: string;
  lifetime_budget?: string;
}

export interface MetaAdsetRow {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  campaign_id: string;
  optimization_goal?: string;
  billing_event?: string;
}

export interface MetaAdRow {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  campaign_id: string;
  adset_id: string;
  creative?: {
    id: string;
    thumbnail_url?: string;
    image_url?: string;
  };
}

interface MetaPaginatedResponse<T> {
  data: T[];
  paging?: {
    cursors: { before: string; after: string };
    next?: string;
    previous?: string;
  };
}

export type MetaInsightLevel = "campaign" | "adset" | "ad";

export interface MetaDateRange {
  since: string; // YYYY-MM-DD
  until: string; // YYYY-MM-DD
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const BASE_URL = "https://graph.facebook.com/v21.0";
const BACKOFF_MS = [2_000, 8_000, 32_000];
const MAX_RETRIES = 3;

export interface MetaClientConfig {
  accessToken: string;
  adAccountId: string; // e.g. "act_910921284849884"
}

export function createMetaClient(config: MetaClientConfig) {
  const { accessToken, adAccountId } = config;

  // Normalise: ensure account ID has the act_ prefix
  const accountId = adAccountId.startsWith("act_")
    ? adAccountId
    : `act_${adAccountId}`;

  // ------------------------------------------------------------------
  // Low-level helpers
  // ------------------------------------------------------------------

  async function fetchWithRetry(
    url: string,
    params: Record<string, string> = {},
  ): Promise<unknown> {
    const searchParams = new URLSearchParams({
      ...params,
      access_token: accessToken,
    });

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const fullUrl = `${url}?${searchParams.toString()}`;
      const response = await fetch(fullUrl);

      if (response.status === 429 || (await isRateLimitError(response.clone()))) {
        if (attempt < MAX_RETRIES) {
          const wait = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
          await sleep(wait);
          continue;
        }
      }

      if (!response.ok) {
        const body = await response.text();
        throw new MetaApiError(
          `Meta API ${response.status}: ${body}`,
          response.status,
          isRetryableStatus(response.status),
        );
      }

      return response.json();
    }

    throw new MetaApiError("Exhausted retries", 429, true);
  }

  /**
   * Follow cursor-based pagination and collect all data pages.
   * When a `next` URL is present, it already contains query params
   * including access_token.
   */
  async function fetchAllPages<T>(
    url: string,
    params: Record<string, string> = {},
  ): Promise<T[]> {
    const allData: T[] = [];
    let result = (await fetchWithRetry(url, params)) as MetaPaginatedResponse<T>;
    allData.push(...result.data);

    while (result.paging?.next) {
      const nextUrl = result.paging.next;
      // next URL already has access_token baked in
      const response = await fetch(nextUrl);
      if (!response.ok) {
        const body = await response.text();
        throw new MetaApiError(
          `Meta API pagination ${response.status}: ${body}`,
          response.status,
          isRetryableStatus(response.status),
        );
      }
      result = (await response.json()) as MetaPaginatedResponse<T>;
      allData.push(...result.data);
    }

    return allData;
  }

  // ------------------------------------------------------------------
  // Metadata endpoints
  // ------------------------------------------------------------------

  async function fetchCampaigns(): Promise<MetaCampaignRow[]> {
    return fetchAllPages<MetaCampaignRow>(
      `${BASE_URL}/${accountId}/campaigns`,
      {
        fields:
          "id,name,status,effective_status,objective,daily_budget,lifetime_budget",
        limit: "200",
      },
    );
  }

  async function fetchAdsets(): Promise<MetaAdsetRow[]> {
    return fetchAllPages<MetaAdsetRow>(
      `${BASE_URL}/${accountId}/adsets`,
      {
        fields:
          "id,name,status,effective_status,campaign_id,optimization_goal,billing_event",
        limit: "200",
      },
    );
  }

  async function fetchAds(): Promise<MetaAdRow[]> {
    return fetchAllPages<MetaAdRow>(
      `${BASE_URL}/${accountId}/ads`,
      {
        fields:
          "id,name,status,effective_status,campaign_id,adset_id,creative{id,thumbnail_url,image_url}",
        limit: "200",
      },
    );
  }

  // ------------------------------------------------------------------
  // Insights endpoints
  // ------------------------------------------------------------------

  const INSIGHT_FIELDS = [
    "campaign_id",
    "campaign_name",
    "adset_id",
    "adset_name",
    "ad_id",
    "ad_name",
    "impressions",
    "clicks",
    "unique_clicks",
    "ctr",
    "cpc",
    "cpm",
    "spend",
    "cost_per_unique_click",
  ].join(",");

  /**
   * Fetch daily insights at the specified grain level for a date range.
   * Uses time_increment=1 to get per-day rows.
   */
  async function fetchDailyInsights(
    level: MetaInsightLevel,
    dateRange: MetaDateRange,
  ): Promise<MetaInsightRow[]> {
    return fetchAllPages<MetaInsightRow>(
      `${BASE_URL}/${accountId}/insights`,
      {
        fields: INSIGHT_FIELDS,
        level,
        time_increment: "1",
        time_range: JSON.stringify({
          since: dateRange.since,
          until: dateRange.until,
        }),
        limit: "200",
      },
    );
  }

  return {
    fetchCampaigns,
    fetchAdsets,
    fetchAds,
    fetchDailyInsights,
    // Expose for testing
    _fetchAllPages: fetchAllPages,
    _fetchWithRetry: fetchWithRetry,
  };
}

export type MetaClient = ReturnType<typeof createMetaClient>;

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class MetaApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "MetaApiError";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

// ---------------------------------------------------------------------------
// Transformation helpers (Meta string values -> typed values)
// ---------------------------------------------------------------------------

export function parseMetaNumber(value: string | undefined | null): number {
  if (value === undefined || value === null || value === "") return 0;
  const n = Number(value);
  return Number.isNaN(n) ? 0 : n;
}

export function parseMetaFloat(
  value: string | undefined | null,
): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

/**
 * Build the date range for a backfill of N days ending today (or a given end date).
 */
export function buildBackfillDateRange(
  days: number,
  endDate?: string,
): MetaDateRange {
  const end = endDate ? new Date(endDate) : new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - days + 1);

  return {
    since: formatDate(start),
    until: formatDate(end),
  };
}

/**
 * Build the date range for incremental sync: yesterday + today.
 */
export function buildIncrementalDateRange(today?: string): MetaDateRange {
  const end = today ? new Date(today) : new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 1);

  return {
    since: formatDate(start),
    until: formatDate(end),
  };
}

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}
