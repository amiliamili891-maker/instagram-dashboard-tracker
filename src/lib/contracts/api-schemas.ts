/**
 * Zod runtime validation schemas for API responses.
 *
 * These schemas mirror the TypeScript interfaces in data-contract.ts.
 * Used for observability-first validation: log violations but never throw,
 * so existing behavior is preserved while contract drift is surfaced early.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Ghstly Partner API Schemas
// ---------------------------------------------------------------------------

export const GhstlyStatsRowSchema = z.object({
  campaign_id: z.string().nullable(),
  adset_id: z.string().nullable(),
  ad_id: z.string().nullable(),
  visits: z.number(),
  chats: z.number(),
  reveals: z.number(),
  click_throughs: z.number(),
  conversions: z.number(),
});

export const GhstlyStatsSummarySchema = z.object({
  visits: z.number(),
  chats: z.number(),
  reveals: z.number(),
  click_throughs: z.number(),
  conversions: z.number(),
});

export const GhstlyStatsResponseSchema = z.object({
  items: z.array(GhstlyStatsRowSchema),
  summary: GhstlyStatsSummarySchema,
});

export const GhstlyStatsDailyRowSchema = z.object({
  date: z.string(),
  campaign_id: z.string().nullable(),
  adset_id: z.string().nullable(),
  ad_id: z.string().nullable(),
  visits: z.number(),
  chats: z.number(),
  reveals: z.number(),
  click_throughs: z.number(),
  conversions: z.number(),
});

export const GhstlyStatsDailyResponseSchema = z.object({
  items: z.array(GhstlyStatsDailyRowSchema),
});

export const GhstlySessionSchema = z.object({
  session_id: z.string(),
  created_at: z.string(),
  started_at: z.string(),
  ended_at: z.string().nullable(),
  status: z.string(),
  messages_count: z.number(),
  brand: z.string(),
  reached_reveal: z.boolean(),
  clicked_through: z.boolean(),
  converted: z.boolean(),
  campaign: z.string(),
  keyword: z.string(),
  creative: z.string(),
  city: z.string(),
  region: z.string(),
  country: z.string(),
  // Optional fields
  brand_slug: z.string().optional(),
  phase: z.string().nullable().optional(),
  conversion_status: z.string().optional(),
  converted_at: z.string().nullable().optional(),
  reveal_platform: z.string().nullable().optional(),
  reveal_username: z.string().nullable().optional(),
  source: z.string().optional(),
  medium: z.string().optional(),
  ad_id: z.string().optional(),
  lead_age: z.string().nullable().optional(),
  lead_gender: z.string().nullable().optional(),
  lead_name: z.string().nullable().optional(),
  photos_sent: z.number().optional(),
  voice_messages_sent: z.number().optional(),
  ip_address: z.string().optional(),
  user_agent: z.string().optional(),
});

export const GhstlySessionsResponseSchema = z.object({
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
  items: z.array(GhstlySessionSchema),
});

export const GhstlySessionMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  created_at: z.string(),
});

export const GhstlySessionMessagesResponseSchema = z.object({
  session_id: z.string(),
  brand: z.string(),
  status: z.string(),
  created_at: z.string(),
  messages_count: z.number(),
  messages: z.array(GhstlySessionMessageSchema),
});

// ---------------------------------------------------------------------------
// Meta Graph API Schemas
// ---------------------------------------------------------------------------

export const MetaInsightRowSchema = z.object({
  ad_id: z.string().optional(),
  ad_name: z.string().optional(),
  adset_id: z.string().optional(),
  adset_name: z.string().optional(),
  campaign_id: z.string(),
  campaign_name: z.string(),
  impressions: z.string(),
  clicks: z.string(),
  unique_clicks: z.string().optional(),
  ctr: z.string(),
  cpc: z.string(),
  cpm: z.string(),
  spend: z.string(),
  cost_per_unique_click: z.string().optional(),
  date_start: z.string(),
  date_stop: z.string(),
});

export const MetaPagingSchema = z.object({
  cursors: z.object({
    before: z.string(),
    after: z.string(),
  }),
  next: z.string().optional(),
  previous: z.string().optional(),
});

export const MetaInsightsResponseSchema = z.object({
  data: z.array(MetaInsightRowSchema),
  paging: MetaPagingSchema.optional(),
});

export const MetaCampaignRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  effective_status: z.string(),
  objective: z.string(),
  daily_budget: z.string().optional(),
  lifetime_budget: z.string().optional(),
});

export const MetaAdsetRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  effective_status: z.string(),
  campaign_id: z.string(),
  optimization_goal: z.string().optional(),
  billing_event: z.string().optional(),
});

export const MetaAdRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  effective_status: z.string(),
  campaign_id: z.string(),
  adset_id: z.string(),
  creative: z
    .object({
      id: z.string(),
      thumbnail_url: z.string().optional(),
      image_url: z.string().optional(),
    })
    .optional(),
});

// ---------------------------------------------------------------------------
// Validation helper
// ---------------------------------------------------------------------------

/**
 * Validate a response and log violations without throwing.
 * Returns the parsed data on success, or the raw input on failure.
 */
export function validateApiResponse<T>(
  schema: z.ZodType<T>,
  data: unknown,
  label: string,
): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    console.error(`${label} contract violation:`, result.error.issues);
  }
  // Always return the raw data cast to T — observability only, don't break flow
  return data as T;
}
