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

describe("SparklineCell", () => {
  it("renders a loading skeleton with correct dimensions", async () => {
    const { SparklineCell } = await import("@/components/sparkline-cell");
    const { container } = render(
      <SparklineCell data={[1, 2, 3]} />,
    );
    const skeleton = container.querySelector(".skeleton-cell.skeleton-chart");
    expect(skeleton).not.toBeNull();
    expect(skeleton?.getAttribute("style")).toContain("width: 100px");
    expect(skeleton?.getAttribute("style")).toContain("height: 28px");
  });
});
