import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildBackfillDateRange,
  buildIncrementalDateRange,
  parseMetaFloat,
  parseMetaNumber,
} from "@/lib/api/meta-client";
import type {
  MetaInsightRow,
  MetaCampaignRow,
  MetaAdsetRow,
  MetaAdRow,
} from "@/lib/api/meta-client";

import {
  buildNaturalKey,
  transformCampaign,
  transformAdset,
  transformAd,
  transformInsight,
} from "@/lib/sync/meta-sync";
import type {
  CampaignRow,
  AdsetRow,
  AdRow,
  DailyMetaStatsRow,
} from "@/lib/sync/meta-sync";

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

function loadFixture<T>(name: string): T {
  const filePath = path.join(
    process.cwd(),
    "src",
    "test",
    "fixtures",
    name,
  );
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

const campaignInsightsFixture = loadFixture<{ data: MetaInsightRow[] }>(
  "meta-campaign-insights.json",
);
const adInsightsFixture = loadFixture<{ data: MetaInsightRow[] }>(
  "meta-ad-insights.json",
);
const dailyAdInsightsFixture = loadFixture<{ data: MetaInsightRow[] }>(
  "meta-ad-daily-insights.json",
);

// ---------------------------------------------------------------------------
// parseMetaNumber / parseMetaFloat
// ---------------------------------------------------------------------------

describe("parseMetaNumber", () => {
  it("parses a valid integer string", () => {
    expect(parseMetaNumber("599")).toBe(599);
  });

  it("parses a valid float string as a number", () => {
    expect(parseMetaNumber("5.42")).toBe(5.42);
  });

  it("returns 0 for empty string", () => {
    expect(parseMetaNumber("")).toBe(0);
  });

  it("returns 0 for undefined", () => {
    expect(parseMetaNumber(undefined)).toBe(0);
  });

  it("returns 0 for null", () => {
    expect(parseMetaNumber(null)).toBe(0);
  });

  it("returns 0 for NaN-producing string", () => {
    expect(parseMetaNumber("not-a-number")).toBe(0);
  });
});

describe("parseMetaFloat", () => {
  it("parses a valid float string", () => {
    expect(parseMetaFloat("10.350584")).toBe(10.350584);
  });

  it("returns null for empty string", () => {
    expect(parseMetaFloat("")).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(parseMetaFloat(undefined)).toBeNull();
  });

  it("returns null for NaN-producing string", () => {
    expect(parseMetaFloat("abc")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// transformCampaign
// ---------------------------------------------------------------------------

describe("transformCampaign", () => {
  it("transforms a raw Meta campaign row into a CampaignRow", () => {
    const raw: MetaCampaignRow = {
      id: "120243919935230528",
      name: "AF_Ghstly_0005",
      status: "ACTIVE",
      effective_status: "ACTIVE",
      objective: "OUTCOME_TRAFFIC",
    };

    const result = transformCampaign(raw, "act_123", "batch-uuid-1");

    expect(result).toEqual<CampaignRow>({
      id: "120243919935230528",
      account_id: "act_123",
      name: "AF_Ghstly_0005",
      status: "ACTIVE",
      effective_status: "ACTIVE",
      objective: "OUTCOME_TRAFFIC",
      daily_budget: null,
      lifetime_budget: null,
      sync_batch_id: "batch-uuid-1",
      source_payload: raw as unknown as Record<string, unknown>,
    });
  });

  it("handles daily_budget and lifetime_budget when present", () => {
    const raw: MetaCampaignRow = {
      id: "120243919935230528",
      name: "AF_Ghstly_0005",
      status: "ACTIVE",
      effective_status: "ACTIVE",
      objective: "OUTCOME_TRAFFIC",
      daily_budget: "5000",
      lifetime_budget: "150000",
    };

    const result = transformCampaign(raw, "act_123", "batch-uuid-1");

    expect(result.daily_budget).toBe(5000);
    expect(result.lifetime_budget).toBe(150000);
  });
});

// ---------------------------------------------------------------------------
// transformAdset
// ---------------------------------------------------------------------------

describe("transformAdset", () => {
  it("transforms a raw Meta adset row into an AdsetRow", () => {
    const raw: MetaAdsetRow = {
      id: "120243919935240528",
      name: "AF_Ghstly_CMP0005_Set1",
      status: "ACTIVE",
      effective_status: "ACTIVE",
      campaign_id: "120243919935230528",
      optimization_goal: "LINK_CLICKS",
      billing_event: "IMPRESSIONS",
    };

    const result = transformAdset(raw, "batch-uuid-1");

    expect(result).toEqual<AdsetRow>({
      id: "120243919935240528",
      campaign_id: "120243919935230528",
      name: "AF_Ghstly_CMP0005_Set1",
      status: "ACTIVE",
      effective_status: "ACTIVE",
      optimization_goal: "LINK_CLICKS",
      billing_event: "IMPRESSIONS",
      sync_batch_id: "batch-uuid-1",
      source_payload: raw as unknown as Record<string, unknown>,
    });
  });
});

// ---------------------------------------------------------------------------
// transformAd
// ---------------------------------------------------------------------------

describe("transformAd", () => {
  it("transforms a raw Meta ad row into an AdRow", () => {
    const raw: MetaAdRow = {
      id: "120243919935250528",
      name: "AF_Ghstly_CMP0005_Set1_Ad1",
      status: "ACTIVE",
      effective_status: "ACTIVE",
      campaign_id: "120243919935230528",
      adset_id: "120243919935240528",
      creative: {
        id: "123456",
        thumbnail_url: "https://example.com/thumb.jpg",
      },
    };

    const result = transformAd(raw, "batch-uuid-1");

    expect(result).toEqual<AdRow>({
      id: "120243919935250528",
      campaign_id: "120243919935230528",
      adset_id: "120243919935240528",
      name: "AF_Ghstly_CMP0005_Set1_Ad1",
      status: "ACTIVE",
      effective_status: "ACTIVE",
      creative_thumbnail_url: "https://example.com/thumb.jpg",
      sync_batch_id: "batch-uuid-1",
      source_payload: raw as unknown as Record<string, unknown>,
    });
  });

  it("handles missing creative field", () => {
    const raw: MetaAdRow = {
      id: "120243919935250528",
      name: "AF_Ghstly_CMP0005_Set1_Ad1",
      status: "ACTIVE",
      effective_status: "ACTIVE",
      campaign_id: "120243919935230528",
      adset_id: "120243919935240528",
    };

    const result = transformAd(raw, "batch-uuid-1");
    expect(result.creative_thumbnail_url).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// transformInsight — from fixture data
// ---------------------------------------------------------------------------

describe("transformInsight", () => {
  it("transforms a campaign-level insight row from fixtures", () => {
    const raw = campaignInsightsFixture.data[0];
    const result = transformInsight(raw, "campaign", "batch-uuid-1");

    expect(result.report_date).toBe("2026-03-14");
    expect(result.entity_level).toBe("campaign");
    expect(result.entity_id).toBe("120243919935230528");
    expect(result.campaign_id).toBe("120243919935230528");
    expect(result.adset_id).toBeNull();
    expect(result.ad_id).toBeNull();
    expect(result.spend).toBe(5.42);
    expect(result.impressions).toBe(599);
    expect(result.clicks).toBe(62);
    expect(result.unique_clicks).toBe(60);
    expect(result.cpc).toBeCloseTo(0.087419);
    expect(result.cpm).toBeCloseTo(9.048414);
    expect(result.ctr).toBeCloseTo(10.350584);
    expect(result.sync_batch_id).toBe("batch-uuid-1");
  });

  it("transforms an ad-level insight row from fixtures", () => {
    const raw = adInsightsFixture.data[0];
    const result = transformInsight(raw, "ad", "batch-uuid-1");

    expect(result.entity_level).toBe("ad");
    expect(result.entity_id).toBe("120243919935250528");
    expect(result.campaign_id).toBe("120243919935230528");
    expect(result.adset_id).toBe("120243919935240528");
    expect(result.ad_id).toBe("120243919935250528");
    expect(result.spend).toBe(4.67);
    expect(result.impressions).toBe(504);
    expect(result.clicks).toBe(53);
  });

  it("transforms a daily ad-level insight row", () => {
    const raw = dailyAdInsightsFixture.data[0];
    const result = transformInsight(raw, "ad", "batch-uuid-1");

    // Daily rows have date_start === date_stop
    expect(result.report_date).toBe("2026-03-18");
    expect(result.entity_level).toBe("ad");
    expect(result.entity_id).toBe("120243990353640528");
    expect(result.spend).toBe(19.94);
  });

  it("handles missing cpc field (zero clicks row)", () => {
    // From daily fixture: row with 0 clicks, no cpc field
    const raw = dailyAdInsightsFixture.data[8];
    const result = transformInsight(raw, "ad", "batch-uuid-1");

    expect(result.clicks).toBe(0);
    expect(result.cpc).toBeNull();
  });

  it("preserves all Meta string values as numbers, not strings", () => {
    const raw = campaignInsightsFixture.data[0];
    const result = transformInsight(raw, "campaign", "batch-uuid-1");

    expect(typeof result.spend).toBe("number");
    expect(typeof result.impressions).toBe("number");
    expect(typeof result.clicks).toBe("number");
    expect(typeof result.unique_clicks).toBe("number");
  });

  it("transforms all ad-level fixture rows without error", () => {
    const rows = adInsightsFixture.data.map((raw) =>
      transformInsight(raw, "ad", "batch-uuid-1"),
    );

    expect(rows.length).toBe(adInsightsFixture.data.length);
    for (const row of rows) {
      expect(row.entity_level).toBe("ad");
      expect(typeof row.entity_id).toBe("string");
      expect(row.entity_id.length).toBeGreaterThan(0);
    }
  });

  it("transforms all campaign-level fixture rows without error", () => {
    const rows = campaignInsightsFixture.data.map((raw) =>
      transformInsight(raw, "campaign", "batch-uuid-1"),
    );

    expect(rows.length).toBe(campaignInsightsFixture.data.length);
    for (const row of rows) {
      expect(row.entity_level).toBe("campaign");
      expect(row.adset_id).toBeNull();
      expect(row.ad_id).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// buildNaturalKey
// ---------------------------------------------------------------------------

describe("buildNaturalKey", () => {
  it("builds a colon-separated natural key", () => {
    expect(
      buildNaturalKey("2026-03-18", "ad", "120243990353640528"),
    ).toBe("2026-03-18:ad:120243990353640528");
  });

  it("produces unique keys for different entity levels", () => {
    const id = "120243990353620528";
    const date = "2026-03-18";

    const campaignKey = buildNaturalKey(date, "campaign", id);
    const adsetKey = buildNaturalKey(date, "adset", id);
    const adKey = buildNaturalKey(date, "ad", id);

    expect(new Set([campaignKey, adsetKey, adKey]).size).toBe(3);
  });

  it("produces unique keys for different dates", () => {
    const key1 = buildNaturalKey("2026-03-18", "ad", "123");
    const key2 = buildNaturalKey("2026-03-19", "ad", "123");

    expect(key1).not.toBe(key2);
  });
});

// ---------------------------------------------------------------------------
// buildBackfillDateRange / buildIncrementalDateRange
// ---------------------------------------------------------------------------

describe("buildBackfillDateRange", () => {
  it("builds a 30-day range ending on the given date", () => {
    const range = buildBackfillDateRange(30, "2026-03-20");

    expect(range.since).toBe("2026-02-19");
    expect(range.until).toBe("2026-03-20");
  });

  it("builds a 7-day range", () => {
    const range = buildBackfillDateRange(7, "2026-03-20");

    expect(range.since).toBe("2026-03-14");
    expect(range.until).toBe("2026-03-20");
  });

  it("builds a 1-day range (single day)", () => {
    const range = buildBackfillDateRange(1, "2026-03-20");

    expect(range.since).toBe("2026-03-20");
    expect(range.until).toBe("2026-03-20");
  });
});

describe("buildIncrementalDateRange", () => {
  it("builds a range covering yesterday and today", () => {
    const range = buildIncrementalDateRange("2026-03-20");

    expect(range.since).toBe("2026-03-19");
    expect(range.until).toBe("2026-03-20");
  });
});

// ---------------------------------------------------------------------------
// Idempotency logic
// ---------------------------------------------------------------------------

describe("idempotency", () => {
  it("transforming the same insight row twice produces identical output", () => {
    const raw = adInsightsFixture.data[0];

    const result1 = transformInsight(raw, "ad", "batch-uuid-1");
    const result2 = transformInsight(raw, "ad", "batch-uuid-1");

    expect(result1).toEqual(result2);
  });

  it("transforming the same campaign row twice produces identical output", () => {
    const raw: MetaCampaignRow = {
      id: "120243919935230528",
      name: "AF_Ghstly_0005",
      status: "ACTIVE",
      effective_status: "ACTIVE",
      objective: "OUTCOME_TRAFFIC",
    };

    const result1 = transformCampaign(raw, "act_123", "batch-uuid-1");
    const result2 = transformCampaign(raw, "act_123", "batch-uuid-1");

    expect(result1).toEqual(result2);
  });

  it("natural keys are stable across multiple calls", () => {
    const key1 = buildNaturalKey("2026-03-18", "ad", "120243990353640528");
    const key2 = buildNaturalKey("2026-03-18", "ad", "120243990353640528");

    expect(key1).toBe(key2);
  });

  it("different sync_batch_ids produce different row content (only batch changes)", () => {
    const raw = adInsightsFixture.data[0];

    const result1 = transformInsight(raw, "ad", "batch-1");
    const result2 = transformInsight(raw, "ad", "batch-2");

    expect(result1.sync_batch_id).toBe("batch-1");
    expect(result2.sync_batch_id).toBe("batch-2");

    // Everything else is identical
    expect({ ...result1, sync_batch_id: "x" }).toEqual({
      ...result2,
      sync_batch_id: "x",
    });
  });
});

// ---------------------------------------------------------------------------
// 19-digit ID safety
// ---------------------------------------------------------------------------

describe("19-digit ID safety", () => {
  it("preserves full 18-digit campaign IDs as strings", () => {
    const raw = campaignInsightsFixture.data[0];
    const result = transformInsight(raw, "campaign", "batch-uuid-1");

    // The campaign ID is 18 digits — stored as string, no precision loss
    expect(result.campaign_id).toBe("120243919935230528");
    expect(typeof result.campaign_id).toBe("string");
  });

  it("preserves full 18-digit ad IDs as strings", () => {
    const raw = adInsightsFixture.data[0];
    const result = transformInsight(raw, "ad", "batch-uuid-1");

    expect(result.ad_id).toBe("120243919935250528");
    expect(typeof result.ad_id).toBe("string");
  });
});
