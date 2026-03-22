import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

// Mock next/dynamic to render the loading fallback
vi.mock("next/dynamic", () => ({
  __esModule: true,
  default: (_loader: () => Promise<unknown>, opts?: { loading?: () => React.ReactNode }) => {
    const MockComponent = () => {
      if (opts?.loading) return opts.loading();
      return <div data-testid="dynamic-placeholder" />;
    };
    MockComponent.displayName = "DynamicMock";
    return MockComponent;
  },
}));

describe("TrendChart", () => {
  it("renders a loading skeleton with correct dimensions", async () => {
    const { TrendChart } = await import("@/components/trend-chart");
    const { container } = render(
      <TrendChart
        primaryData={[{ date: "2026-03-01", value: 10 }]}
        comparisonData={null}
        metric="spend"
        metricLabel="Spend"
      />,
    );
    const skeleton = container.querySelector(".skeleton-cell.skeleton-chart");
    expect(skeleton).not.toBeNull();
    expect(skeleton?.getAttribute("style")).toContain("width: 100%");
    expect(skeleton?.getAttribute("style")).toContain("height: 360px");
  });
});
