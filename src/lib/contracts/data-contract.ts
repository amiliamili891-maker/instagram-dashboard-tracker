/**
 * Data Contract: Ghstly Ad Analytics Dashboard
 *
 * Codified from live API responses captured 2026-03-21.
 * Fixtures: src/test/fixtures/ghstly-*.json, meta-*.json
 *
 * Sources:
 *   - Ghstly Partner API: https://ghstly.chat/api/partner
 *   - Meta Graph API v21.0: https://graph.facebook.com/v21.0/
 */

// ---------------------------------------------------------------------------
// Ghstly Partner API — Response Types
// ---------------------------------------------------------------------------

/** A single row from GET /api/partner/stats — ad-level aggregate */
export interface GhstlyStatsRow {
  /** Meta campaign ID or null for organic/unjoinable rows */
  campaign_id: string | null;
  /** Meta adset ID or null for organic/unjoinable rows */
  adset_id: string | null;
  /** Meta ad ID or placeholder like "link_in_bio" */
  ad_id: string | null;
  visits: number;
  chats: number;
  reveals: number;
  click_throughs: number;
  conversions: number;
}

/** Summary totals returned at the top level of GET /api/partner/stats */
export interface GhstlyStatsSummary {
  visits: number;
  chats: number;
  reveals: number;
  click_throughs: number;
  conversions: number;
}

/** Full response from GET /api/partner/stats */
export interface GhstlyStatsResponse {
  items: GhstlyStatsRow[];
  summary: GhstlyStatsSummary;
}

/** A single row from GET /api/partner/stats/daily — ad-level daily grain */
export interface GhstlyStatsDailyRow {
  /** ISO date string, e.g. "2026-03-21" */
  date: string;
  campaign_id: string | null;
  adset_id: string | null;
  ad_id: string | null;
  visits: number;
  chats: number;
  reveals: number;
  click_throughs: number;
  conversions: number;
}

/** Full response from GET /api/partner/stats/daily */
export interface GhstlyStatsDailyResponse {
  items: GhstlyStatsDailyRow[];
}

/** Session status values observed in live data */
export type GhstlySessionStatus = 'active' | 'completed' | 'abandoned' | 'disconnected';

/** Chat phase values observed in live data */
export type GhstlyChatPhase =
  | 'rapport'
  | 'post_reveal'
  | null;

/** Conversion status values observed in live data */
export type GhstlyConversionStatus = 'new' | 'converted';

/** A single session from GET /api/partner/sessions */
export interface GhstlySession {
  session_id: string;
  created_at: string;
  started_at: string;
  ended_at: string | null;
  status: string;
  messages_count: number;
  brand: string;
  reached_reveal: boolean;
  clicked_through: boolean;
  converted: boolean;

  // UTM fields — these are the JOIN KEYS to Meta
  /** Maps to Meta campaign_id */
  campaign: string;
  /** Maps to Meta adset_id */
  keyword: string;
  /** Maps to Meta ad_id */
  creative: string;

  // Geo
  city: string;
  region: string;
  country: string;

  // Optional fields that may or may not be present
  brand_slug?: string;
  phase?: string | null;
  conversion_status?: string;
  converted_at?: string | null;
  reveal_platform?: string | null;
  reveal_username?: string | null;
  source?: string;
  medium?: string;
  ad_id?: string;
  lead_age?: string | null;
  lead_gender?: string | null;
  lead_name?: string | null;
  photos_sent?: number;
  voice_messages_sent?: number;
  chat_type?: string;
  chatter_name?: string | null;
  ip_address?: string;
  user_agent?: string;
}

/** Full response from GET /api/partner/sessions */
export interface GhstlySessionsResponse {
  total: number;
  limit: number;
  offset: number;
  items: GhstlySession[];
}

// ---------------------------------------------------------------------------
// Meta Graph API — Response Types
// ---------------------------------------------------------------------------

/** A single row from Meta Insights API (ad, adset, or campaign level) */
export interface MetaInsightsRow {
  /** Present at ad level */
  ad_id?: string;
  ad_name?: string;
  /** Present at ad and adset levels */
  adset_id?: string;
  adset_name?: string;
  /** Always present */
  campaign_id: string;
  campaign_name: string;

  // All numeric values come as STRINGS from the Meta API
  impressions: string;
  clicks: string;
  unique_clicks: string;
  ctr: string;
  cpc: string;
  cpm: string;
  spend: string;
  cost_per_unique_click: string;

  /** ISO date — start of the reporting period */
  date_start: string;
  /** ISO date — end of the reporting period */
  date_stop: string;
}

/** Meta Insights API paginated response */
export interface MetaInsightsResponse {
  data: MetaInsightsRow[];
  paging?: {
    cursors: {
      before: string;
      after: string;
    };
    next?: string;
    previous?: string;
  };
}

/** Meta campaign metadata from /campaigns endpoint */
export interface MetaCampaign {
  id: string;
  name: string;
  status: string;
  objective: string;
}

// ---------------------------------------------------------------------------
// Field Mapping: Ghstly → Canonical Join Keys
// ---------------------------------------------------------------------------

/**
 * Maps Ghstly field names to canonical (Meta-aligned) join key names.
 *
 * CRITICAL: The Ghstly naming is misleading:
 *   - sessions.creative  → actually the Meta AD ID
 *   - sessions.keyword   → actually the Meta ADSET ID
 *   - sessions.campaign  → the Meta CAMPAIGN ID (correct name)
 *   - sessions.ad_id     → always empty, IGNORED
 *
 * The /stats endpoint uses canonical names (campaign_id, adset_id, ad_id).
 */
export const GHSTLY_SESSION_FIELD_MAP = {
  /** sessions.campaign → canonical campaign_id */
  campaign: 'campaign_id',
  /** sessions.keyword → canonical adset_id */
  keyword: 'adset_id',
  /** sessions.creative → canonical ad_id */
  creative: 'ad_id',
} as const;

/**
 * The /stats endpoint already uses canonical names, but we document it
 * explicitly for clarity and contract testing.
 */
export const GHSTLY_STATS_FIELD_MAP = {
  campaign_id: 'campaign_id',
  adset_id: 'adset_id',
  ad_id: 'ad_id',
} as const;

/**
 * Meta field names are already canonical — they match the join target.
 */
export const META_FIELD_MAP = {
  campaign_id: 'campaign_id',
  adset_id: 'adset_id',
  ad_id: 'ad_id',
} as const;

// ---------------------------------------------------------------------------
// Joinability Classification
// ---------------------------------------------------------------------------

/** Known placeholder/invalid values that make a row unjoinable */
const UNJOINABLE_PATTERNS = [
  '{{campaign.id}}',
  '{{ad.id}}',
  '{{adset.id}}',
  'link_in_bio',
  '',
] as const;

export type JoinStatus = 'joinable' | 'unjoinable';

export interface JoinClassification {
  status: JoinStatus;
  /** Human-readable reason when unjoinable */
  issue: string | null;
}

/**
 * Classify whether a Ghstly row can be joined to Meta data.
 *
 * Rules:
 *   - All three IDs (campaign_id, adset_id, ad_id) must be non-null,
 *     non-empty, and not a known placeholder.
 *   - A row from a non-Meta source (source !== "meta") is unjoinable.
 */
export function classifyJoinability(row: {
  campaign_id: string | null;
  adset_id: string | null;
  ad_id: string | null;
  source?: string;
}): JoinClassification {
  // Non-Meta source
  if (row.source !== undefined && row.source !== 'meta') {
    return {
      status: 'unjoinable',
      issue: `non-meta source: "${row.source || '(empty)'}"`,
    };
  }

  // Check each ID field
  const fields = [
    { name: 'campaign_id', value: row.campaign_id },
    { name: 'adset_id', value: row.adset_id },
    { name: 'ad_id', value: row.ad_id },
  ];

  for (const field of fields) {
    if (field.value === null || field.value === undefined) {
      return {
        status: 'unjoinable',
        issue: `${field.name} is null`,
      };
    }
    if (UNJOINABLE_PATTERNS.includes(field.value as typeof UNJOINABLE_PATTERNS[number])) {
      return {
        status: 'unjoinable',
        issue: `${field.name} is placeholder: "${field.value}"`,
      };
    }
  }

  return { status: 'joinable', issue: null };
}

/**
 * Normalize a Ghstly session's UTM fields into canonical join key names.
 * Applies the GHSTLY_SESSION_FIELD_MAP.
 */
export function normalizeSessionJoinKeys(session: GhstlySession): {
  campaign_id: string;
  adset_id: string;
  ad_id: string;
} {
  return {
    campaign_id: session.campaign,
    adset_id: session.keyword,
    ad_id: session.creative,
  };
}

// ---------------------------------------------------------------------------
// Metric Dictionary
// ---------------------------------------------------------------------------

export type MetricSource = 'meta' | 'ghstly' | 'derived';
export type MetricGrain = 'ad' | 'adset' | 'campaign' | 'daily' | 'all';

export interface MetricDefinition {
  /** Canonical metric name used in code and database */
  name: string;
  /** Human-readable label for UI */
  label: string;
  /** Where the raw data comes from */
  source: MetricSource;
  /** Formula or description of how it's computed */
  formula: string;
  /** Finest granularity available */
  grain: MetricGrain;
  /** What to return when denominator is zero */
  nullBehavior: 'null' | 'zero';
  /**
   * Can this metric be summed across child rows to produce a parent total?
   * false = must use same-grain source data (e.g. unique_clicks, Ghstly unique metrics)
   */
  additive: boolean;
  /** Notes about freshness or special handling */
  notes?: string;
}

/**
 * The canonical metric dictionary for the dashboard.
 * Every metric that appears in the UI or database is defined here.
 */
export const METRIC_DICTIONARY: MetricDefinition[] = [
  // --- Meta native metrics ---
  {
    name: 'impressions',
    label: 'Impressions',
    source: 'meta',
    formula: 'Meta API impressions field',
    grain: 'ad',
    nullBehavior: 'zero',
    additive: true,
  },
  {
    name: 'clicks',
    label: 'Clicks',
    source: 'meta',
    formula: 'Meta API clicks field',
    grain: 'ad',
    nullBehavior: 'zero',
    additive: true,
  },
  {
    name: 'unique_clicks',
    label: 'Unique Clicks',
    source: 'meta',
    formula: 'Meta API unique_clicks field',
    grain: 'ad',
    nullBehavior: 'zero',
    additive: false,
    notes: 'Must fetch at campaign/adset grain from Meta — never sum ad-level unique_clicks',
  },
  {
    name: 'spend',
    label: 'Spend',
    source: 'meta',
    formula: 'Meta API spend field',
    grain: 'ad',
    nullBehavior: 'zero',
    additive: true,
  },
  {
    name: 'ctr',
    label: 'CTR',
    source: 'derived',
    formula: 'clicks / impressions',
    grain: 'ad',
    nullBehavior: 'null',
    additive: false,
  },
  {
    name: 'cpc',
    label: 'CPC',
    source: 'derived',
    formula: 'spend / clicks',
    grain: 'ad',
    nullBehavior: 'null',
    additive: false,
  },
  {
    name: 'cpm',
    label: 'CPM',
    source: 'derived',
    formula: '(spend / impressions) * 1000',
    grain: 'ad',
    nullBehavior: 'null',
    additive: false,
  },
  {
    name: 'cost_per_unique_click',
    label: 'Cost per Unique Click',
    source: 'derived',
    formula: 'spend / unique_clicks',
    grain: 'ad',
    nullBehavior: 'null',
    additive: false,
    notes: 'Must use same-grain data at campaign/adset level',
  },

  // --- Ghstly native metrics ---
  {
    name: 'visits',
    label: 'Visits',
    source: 'ghstly',
    formula: 'Ghstly /stats visits field',
    grain: 'ad',
    nullBehavior: 'zero',
    additive: false,
    notes: 'Non-unique by default. Not used for reconciliation drift checks.',
  },
  {
    name: 'chats',
    label: 'Chats',
    source: 'ghstly',
    formula: 'Ghstly /stats chats field',
    grain: 'ad',
    nullBehavior: 'zero',
    additive: false,
    notes: 'Exact campaign/adset totals from filtered /stats summary, not summed ad rows',
  },
  {
    name: 'reveals',
    label: 'Reveals',
    source: 'ghstly',
    formula: 'Ghstly /stats reveals field',
    grain: 'ad',
    nullBehavior: 'zero',
    additive: false,
    notes: 'Exact campaign/adset totals from filtered /stats summary',
  },
  {
    name: 'click_throughs',
    label: 'Click-Throughs',
    source: 'ghstly',
    formula: 'Ghstly /stats click_throughs field',
    grain: 'ad',
    nullBehavior: 'zero',
    additive: false,
    notes: 'Exact campaign/adset totals from filtered /stats summary',
  },
  {
    name: 'ghstly_conversions',
    label: 'Ghstly Conversions',
    source: 'ghstly',
    formula: 'Ghstly /stats conversions field',
    grain: 'ad',
    nullBehavior: 'zero',
    additive: false,
    notes: 'Always displayed separately from Meta conversions',
  },

  // --- Cross-source derived metrics ---
  {
    name: 'chat_rate',
    label: 'Chat Rate',
    source: 'derived',
    formula: 'chats / visits',
    grain: 'ad',
    nullBehavior: 'null',
    additive: false,
    notes: 'Can exceed 100% due to non-unique visit counting',
  },
  {
    name: 'cost_per_chat',
    label: 'Cost per Chat',
    source: 'derived',
    formula: 'spend / chats',
    grain: 'ad',
    nullBehavior: 'null',
    additive: false,
    notes: 'Requires both Meta (spend) and Ghstly (chats) — suppressed when stale/degraded',
  },
  {
    name: 'reveal_rate',
    label: 'Reveal Rate',
    source: 'derived',
    formula: 'reveals / chats',
    grain: 'ad',
    nullBehavior: 'null',
    additive: false,
  },
  {
    name: 'cost_per_reveal',
    label: 'Cost per Reveal',
    source: 'derived',
    formula: 'spend / reveals',
    grain: 'ad',
    nullBehavior: 'null',
    additive: false,
    notes: 'Requires both Meta and Ghstly — suppressed when stale/degraded',
  },
  {
    name: 'reveal_click_through_rate',
    label: 'Click-Through Rate (Funnel)',
    source: 'derived',
    formula: 'click_throughs / chats',
    grain: 'ad',
    nullBehavior: 'null',
    additive: false,
    notes: 'Denominator is chats (matching Ghstly partner dashboard). Measures % of chatters who clicked through.',
  },
  {
    name: 'conversion_rate',
    label: 'Conversion Rate',
    source: 'derived',
    formula: 'ghstly_conversions / chats',
    grain: 'ad',
    nullBehavior: 'null',
    additive: false,
    notes: 'Denominator is chats (matching Ghstly partner dashboard). Measures % of chatters who converted.',
  },
];

/**
 * Lookup a metric definition by name.
 */
export function getMetricDefinition(name: string): MetricDefinition | undefined {
  return METRIC_DICTIONARY.find((m) => m.name === name);
}

/**
 * Get all metrics that require cross-source data (Meta + Ghstly).
 * These should be suppressed in degraded or stale freshness states.
 */
export function getCrossSourceMetrics(): MetricDefinition[] {
  return METRIC_DICTIONARY.filter(
    (m) =>
      m.source === 'derived' &&
      (m.formula.includes('spend') && (m.formula.includes('chats') || m.formula.includes('reveals')))
  );
}

// ---------------------------------------------------------------------------
// Reconciliation Thresholds
// ---------------------------------------------------------------------------

/**
 * Drift thresholds for reconciling daily_ghstly_stats vs sessions.
 * Only reconcile: chats, reveals, click_throughs, conversions.
 * Do NOT reconcile visits (not comparable between sources).
 */
export const RECONCILIATION_CONFIG = {
  /** Metrics eligible for drift checking */
  reconcilableMetrics: ['chats', 'reveals', 'click_throughs', 'conversions'] as const,

  thresholds: {
    /** Healthy: <= 5% relative OR <= 10 absolute events per ad/day */
    healthy: { relativePercent: 5, absoluteEvents: 10 },
    /** Warning: > 5% and <= 10% OR > 10 absolute events */
    warning: { relativePercent: 10, absoluteEvents: 10 },
    /** Breach: > 10% OR > 25 absolute events after one replay */
    breach: { relativePercent: 10, absoluteEvents: 25 },
  },

  /** On breach: trigger replay for affected source/date window */
  breachPolicy: {
    autoReplay: true,
    maxAutoReplays: 1,
    /** Suppress cross-source recommendations if > 5% of joinable ad/day rows breach */
    suppressionThresholdPercent: 5,
  },
} as const;

// ---------------------------------------------------------------------------
// Data Quality Thresholds
// ---------------------------------------------------------------------------

export const DATA_QUALITY_THRESHOLDS = {
  /** Max acceptable percentage of unjoinable rows among total rows */
  unmatchedJoinRateWarning: 10,
  unmatchedJoinRateCritical: 25,

  /** Max acceptable duplicate rate (same natural key appearing twice) */
  duplicateRateWarning: 1,
  duplicateRateCritical: 5,

  /** Max acceptable null-key rate among Meta-sourced rows */
  nullKeyRateWarning: 2,
  nullKeyRateCritical: 5,
} as const;

// ---------------------------------------------------------------------------
// Reporting Timezone
// ---------------------------------------------------------------------------

/**
 * All reporting days, freshness windows, date filters, and comparisons
 * are computed in this timezone. Never use a fixed UTC offset.
 */
export const REPORTING_TIMEZONE = 'America/Los_Angeles';
