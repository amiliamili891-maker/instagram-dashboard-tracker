import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BudgetSection, type BudgetApiData, type BudgetApiMeta } from "./budget-section";

// ---------------------------------------------------------------------------
// Mock child components that call fetch internally
// ---------------------------------------------------------------------------

vi.mock("./image-lightbox", () => ({
  ImageLightbox: ({ adId }: { adId: string }) => <span data-testid={`thumb-${adId}`} />,
}));

// ---------------------------------------------------------------------------
// Mock fetch — only for budget API calls
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
global.fetch = mockFetch;

function makeApiResponse(numDays: number, spend = 70): { data: BudgetApiData; meta: BudgetApiMeta } {
  return {
    data: {
      pauseCandidates: [
        {
          entityId: "ad_001",
          entityLevel: "ad" as const,
          action: "pause" as const,
          currentSpend: spend,
          suggestedSpend: 0,
          dailySpend: spend / numDays,
          dailySavings: spend / numDays,
          rationale: `PAUSE — burning $${spend} over ${numDays}d`,
          tier: {
            compositeTier: "Critical",
            compositeColor: "critical",
            drivingMetric: "cost_per_chat",
            metrics: [],
            suppressed: false,
          },
          urgency: 6,
          entityName: "Test Ad",
        },
      ],
      scaleCandidates: [],
      recommendations: [],
      totalCurrentSpend: spend,
      suggestedReallocation: spend / numDays,
      numDays,
    },
    meta: { suppressed: false, days: numDays },
  };
}

const initialResponse = makeApiResponse(7, 70);

beforeEach(() => {
  mockFetch.mockReset();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BudgetSection", () => {
  it("renders initial 7d data without fetching", () => {
    render(
      <BudgetSection
        freshnessState="fresh"
        data={initialResponse.data}
        meta={initialResponse.meta}
      />,
    );

    expect(screen.getByText("Spend (7d)")).toBeDefined();
    expect(screen.getByText("$70.00")).toBeDefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fetches fresh data when clicking a different period", async () => {
    const user = userEvent.setup();
    const resp3d = makeApiResponse(3, 30);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => resp3d,
    });

    render(
      <BudgetSection
        freshnessState="fresh"
        data={initialResponse.data}
        meta={initialResponse.meta}
      />,
    );

    await user.click(screen.getByRole("radio", { name: "3d" }));

    expect(mockFetch).toHaveBeenCalledWith("/api/intelligence/budget?days=3");
  });

  it("fetches fresh data when clicking 7d AFTER another period (Bug 1 regression)", async () => {
    const user = userEvent.setup();

    // First fetch: switching to 3d
    const resp3d = makeApiResponse(3, 30);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => resp3d,
    });

    // Second fetch: switching back to 7d — should refetch, NOT use stale server data
    const resp7d = makeApiResponse(7, 77); // Different spend to prove it refetched
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => resp7d,
    });

    render(
      <BudgetSection
        freshnessState="fresh"
        data={initialResponse.data}
        meta={initialResponse.meta}
      />,
    );

    // Click 3d
    await user.click(screen.getByRole("radio", { name: "3d" }));
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith("/api/intelligence/budget?days=3");

    // Click 7d — must refetch, not use stale server props
    await user.click(screen.getByRole("radio", { name: "7d" }));
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenLastCalledWith("/api/intelligence/budget?days=7");
  });

  it("shows spend column header matching the data period", () => {
    const resp1d = makeApiResponse(1, 10);
    render(
      <BudgetSection
        freshnessState="fresh"
        data={resp1d.data}
        meta={resp1d.meta}
      />,
    );

    expect(screen.getByText("Spend (1d)")).toBeDefined();
  });

  it("hides daily rate subline in spend cell when period is 1 day", () => {
    const resp1d = makeApiResponse(1, 10);
    render(
      <BudgetSection
        freshnessState="fresh"
        data={resp1d.data}
        meta={resp1d.meta}
      />,
    );

    // Should show spend but NOT the daily rate subline under spend
    expect(screen.getByText("$10.00")).toBeDefined();
    // The "spend-daily" class subline should not exist for 1d
    expect(document.querySelector(".spend-daily")).toBeNull();
  });

  it("shows daily rate when period is > 1 day", () => {
    render(
      <BudgetSection
        freshnessState="fresh"
        data={initialResponse.data}
        meta={initialResponse.meta}
      />,
    );

    // Should show both period total and daily rate
    expect(screen.getByText("$70.00")).toBeDefined();
    expect(screen.getByText("~$10.00/day")).toBeDefined();
  });

  it("suppresses when freshness is degraded", () => {
    render(
      <BudgetSection
        freshnessState="degraded"
        data={initialResponse.data}
        meta={initialResponse.meta}
      />,
    );

    expect(screen.getByText(/suppressed/)).toBeDefined();
  });

  it("shows potential savings as daily rate", () => {
    render(
      <BudgetSection
        freshnessState="fresh"
        data={initialResponse.data}
        meta={initialResponse.meta}
      />,
    );

    // suggestedReallocation = 70/7 = $10.00/day
    expect(screen.getByText("Potential savings: $10.00/day")).toBeDefined();
  });
});
