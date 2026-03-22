import { describe, expect, it, vi } from "vitest";
import {
  GhstlyStatsResponseSchema,
  GhstlyStatsDailyResponseSchema,
  GhstlySessionsResponseSchema,
  GhstlySessionMessagesResponseSchema,
  MetaInsightRowSchema,
  MetaInsightsResponseSchema,
  MetaCampaignRowSchema,
  MetaAdsetRowSchema,
  MetaAdRowSchema,
  validateApiResponse,
} from "@/lib/contracts/api-schemas";

// ---------------------------------------------------------------------------
// Fixtures — minimal valid payloads
// ---------------------------------------------------------------------------

const VALID_STATS_ROW = {
  campaign_id: "120244038939310528",
  adset_id: "120244038939320528",
  ad_id: "120244039008080528",
  visits: 540,
  chats: 219,
  reveals: 82,
  click_throughs: 55,
  conversions: 2,
};

const VALID_STATS_RESPONSE = {
  items: [VALID_STATS_ROW],
  summary: {
    visits: 9599,
    chats: 5199,
    reveals: 1714,
    click_throughs: 1162,
    conversions: 40,
  },
};

const VALID_DAILY_ROW = {
  date: "2026-03-21",
  campaign_id: "120244033805690528",
  adset_id: "120244038423200528",
  ad_id: "120244038423210528",
  visits: 4,
  chats: 3,
  reveals: 2,
  click_throughs: 2,
  conversions: 0,
};

const VALID_SESSION = {
  session_id: "e16cbd29-7641-4813-b0b3-85dc2ad4a8ce",
  created_at: "2026-03-21T02:23:29.337394-07:00",
  started_at: "2026-03-21T02:23:29.337391-07:00",
  ended_at: null,
  status: "active",
  messages_count: 17,
  brand: "Ghstly",
  reached_reveal: false,
  clicked_through: false,
  converted: false,
  campaign: "120244144794240528",
  keyword: "120244145635460528",
  creative: "120244145635450528",
  city: "Covington",
  region: "Georgia",
  country: "US",
};

const VALID_SESSIONS_RESPONSE = {
  total: 21433,
  limit: 5,
  offset: 0,
  items: [VALID_SESSION],
};

const VALID_SESSION_MESSAGES_RESPONSE = {
  session_id: "e16cbd29-7641-4813-b0b3-85dc2ad4a8ce",
  brand: "Ghstly",
  status: "active",
  created_at: "2026-03-21T02:23:29.337394-07:00",
  messages_count: 2,
  messages: [
    {
      id: "msg-1",
      role: "user" as const,
      content: "Hi there",
      created_at: "2026-03-21T02:23:30.000000-07:00",
    },
    {
      id: "msg-2",
      role: "assistant" as const,
      content: "Hey! How are you?",
      created_at: "2026-03-21T02:23:31.000000-07:00",
    },
  ],
};

const VALID_META_INSIGHT_ROW = {
  ad_id: "120243919935250528",
  ad_name: "AF_Ghstly_CMP0005_Set1_Ad1",
  adset_id: "120243919935240528",
  adset_name: "AF_Ghstly_CMP0005_Set1",
  campaign_id: "120243919935230528",
  campaign_name: "AF_Ghstly_0005",
  impressions: "504",
  clicks: "53",
  unique_clicks: "52",
  ctr: "10.515873",
  cpc: "0.088113",
  cpm: "9.265873",
  spend: "4.67",
  cost_per_unique_click: "0.089808",
  date_start: "2026-03-14",
  date_stop: "2026-03-20",
};

const VALID_META_CAMPAIGN = {
  id: "120243919935230528",
  name: "AF_Ghstly_0005",
  status: "ACTIVE",
  effective_status: "ACTIVE",
  objective: "OUTCOME_TRAFFIC",
};

const VALID_META_ADSET = {
  id: "120243919935240528",
  name: "AF_Ghstly_CMP0005_Set1",
  status: "ACTIVE",
  effective_status: "ACTIVE",
  campaign_id: "120243919935230528",
};

const VALID_META_AD = {
  id: "120243919935250528",
  name: "AF_Ghstly_CMP0005_Set1_Ad1",
  status: "ACTIVE",
  effective_status: "ACTIVE",
  campaign_id: "120243919935230528",
  adset_id: "120243919935240528",
};

// ---------------------------------------------------------------------------
// Ghstly /stats
// ---------------------------------------------------------------------------

describe("GhstlyStatsResponseSchema", () => {
  it("accepts a valid stats response", () => {
    const result = GhstlyStatsResponseSchema.safeParse(VALID_STATS_RESPONSE);
    expect(result.success).toBe(true);
  });

  it("accepts stats rows with null IDs (organic/unjoinable)", () => {
    const response = {
      items: [
        { ...VALID_STATS_ROW, campaign_id: null, adset_id: null, ad_id: "link_in_bio" },
      ],
      summary: VALID_STATS_RESPONSE.summary,
    };
    const result = GhstlyStatsResponseSchema.safeParse(response);
    expect(result.success).toBe(true);
  });

  it("rejects when items is missing", () => {
    const result = GhstlyStatsResponseSchema.safeParse({
      summary: VALID_STATS_RESPONSE.summary,
    });
    expect(result.success).toBe(false);
  });

  it("rejects when summary is missing", () => {
    const result = GhstlyStatsResponseSchema.safeParse({
      items: [VALID_STATS_ROW],
    });
    expect(result.success).toBe(false);
  });

  it("rejects when a numeric field is a string", () => {
    const result = GhstlyStatsResponseSchema.safeParse({
      items: [{ ...VALID_STATS_ROW, visits: "540" }],
      summary: VALID_STATS_RESPONSE.summary,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Ghstly /stats/daily
// ---------------------------------------------------------------------------

describe("GhstlyStatsDailyResponseSchema", () => {
  it("accepts a valid daily stats response", () => {
    const result = GhstlyStatsDailyResponseSchema.safeParse({
      items: [VALID_DAILY_ROW],
    });
    expect(result.success).toBe(true);
  });

  it("rejects when date is missing from a row", () => {
    const { date: _, ...rowWithoutDate } = VALID_DAILY_ROW;
    const result = GhstlyStatsDailyResponseSchema.safeParse({
      items: [rowWithoutDate],
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Ghstly /sessions
// ---------------------------------------------------------------------------

describe("GhstlySessionsResponseSchema", () => {
  it("accepts a valid sessions response", () => {
    const result = GhstlySessionsResponseSchema.safeParse(VALID_SESSIONS_RESPONSE);
    expect(result.success).toBe(true);
  });

  it("accepts sessions with optional fields", () => {
    const response = {
      ...VALID_SESSIONS_RESPONSE,
      items: [
        {
          ...VALID_SESSION,
          brand_slug: "ghstly",
          phase: "rapport",
          source: "meta",
          medium: "paid_social",
          photos_sent: 1,
          voice_messages_sent: 0,
        },
      ],
    };
    const result = GhstlySessionsResponseSchema.safeParse(response);
    expect(result.success).toBe(true);
  });

  it("rejects when total is missing", () => {
    const { total: _, ...withoutTotal } = VALID_SESSIONS_RESPONSE;
    const result = GhstlySessionsResponseSchema.safeParse(withoutTotal);
    expect(result.success).toBe(false);
  });

  it("rejects when session_id is missing from a session", () => {
    const { session_id: _, ...sessionWithoutId } = VALID_SESSION;
    const result = GhstlySessionsResponseSchema.safeParse({
      ...VALID_SESSIONS_RESPONSE,
      items: [sessionWithoutId],
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Ghstly /sessions/:id/messages
// ---------------------------------------------------------------------------

describe("GhstlySessionMessagesResponseSchema", () => {
  it("accepts a valid session messages response", () => {
    const result = GhstlySessionMessagesResponseSchema.safeParse(
      VALID_SESSION_MESSAGES_RESPONSE,
    );
    expect(result.success).toBe(true);
  });

  it("rejects invalid message role", () => {
    const response = {
      ...VALID_SESSION_MESSAGES_RESPONSE,
      messages: [
        {
          id: "msg-1",
          role: "system",
          content: "test",
          created_at: "2026-03-21T02:23:30.000000-07:00",
        },
      ],
    };
    const result = GhstlySessionMessagesResponseSchema.safeParse(response);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Meta Insights
// ---------------------------------------------------------------------------

describe("MetaInsightRowSchema", () => {
  it("accepts a valid insight row with all fields", () => {
    const result = MetaInsightRowSchema.safeParse(VALID_META_INSIGHT_ROW);
    expect(result.success).toBe(true);
  });

  it("accepts a campaign-level row without ad/adset fields", () => {
    const { ad_id: _, ad_name: __, adset_id: ___, adset_name: ____, ...campaignLevel } =
      VALID_META_INSIGHT_ROW;
    const result = MetaInsightRowSchema.safeParse(campaignLevel);
    expect(result.success).toBe(true);
  });

  it("rejects when numeric values are actual numbers instead of strings", () => {
    const result = MetaInsightRowSchema.safeParse({
      ...VALID_META_INSIGHT_ROW,
      impressions: 504,
    });
    expect(result.success).toBe(false);
  });
});

describe("MetaInsightsResponseSchema", () => {
  it("accepts a valid paginated response", () => {
    const result = MetaInsightsResponseSchema.safeParse({
      data: [VALID_META_INSIGHT_ROW],
      paging: {
        cursors: { before: "abc", after: "def" },
        next: "https://graph.facebook.com/v21.0/...",
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts a response without paging", () => {
    const result = MetaInsightsResponseSchema.safeParse({
      data: [VALID_META_INSIGHT_ROW],
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Meta Campaigns / Adsets / Ads
// ---------------------------------------------------------------------------

describe("MetaCampaignRowSchema", () => {
  it("accepts a valid campaign", () => {
    const result = MetaCampaignRowSchema.safeParse(VALID_META_CAMPAIGN);
    expect(result.success).toBe(true);
  });

  it("accepts a campaign with optional budget fields", () => {
    const result = MetaCampaignRowSchema.safeParse({
      ...VALID_META_CAMPAIGN,
      daily_budget: "5000",
      lifetime_budget: "0",
    });
    expect(result.success).toBe(true);
  });

  it("rejects when name is missing", () => {
    const { name: _, ...withoutName } = VALID_META_CAMPAIGN;
    const result = MetaCampaignRowSchema.safeParse(withoutName);
    expect(result.success).toBe(false);
  });
});

describe("MetaAdsetRowSchema", () => {
  it("accepts a valid adset", () => {
    const result = MetaAdsetRowSchema.safeParse(VALID_META_ADSET);
    expect(result.success).toBe(true);
  });

  it("rejects when campaign_id is missing", () => {
    const { campaign_id: _, ...withoutCampaignId } = VALID_META_ADSET;
    const result = MetaAdsetRowSchema.safeParse(withoutCampaignId);
    expect(result.success).toBe(false);
  });
});

describe("MetaAdRowSchema", () => {
  it("accepts a valid ad", () => {
    const result = MetaAdRowSchema.safeParse(VALID_META_AD);
    expect(result.success).toBe(true);
  });

  it("accepts an ad with creative object", () => {
    const result = MetaAdRowSchema.safeParse({
      ...VALID_META_AD,
      creative: {
        id: "120243919935260528",
        thumbnail_url: "https://example.com/thumb.jpg",
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects when adset_id is missing", () => {
    const { adset_id: _, ...withoutAdsetId } = VALID_META_AD;
    const result = MetaAdRowSchema.safeParse(withoutAdsetId);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateApiResponse helper
// ---------------------------------------------------------------------------

describe("validateApiResponse", () => {
  it("returns raw data even when validation fails", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const invalidData = { items: "not-an-array" };
    const result = validateApiResponse(
      GhstlyStatsResponseSchema,
      invalidData,
      "Test",
    );

    expect(result).toBe(invalidData);
    expect(consoleSpy).toHaveBeenCalledWith(
      "Test contract violation:",
      expect.any(Array),
    );

    consoleSpy.mockRestore();
  });

  it("does not log when validation passes", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    validateApiResponse(
      GhstlyStatsResponseSchema,
      VALID_STATS_RESPONSE,
      "Test",
    );

    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
