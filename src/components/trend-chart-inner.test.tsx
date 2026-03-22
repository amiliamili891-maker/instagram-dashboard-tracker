import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { TrendChartInner } from "@/components/trend-chart-inner";

describe("TrendChartInner", () => {
  it("renders the chart wrapper div", () => {
    const { container } = render(
      <TrendChartInner
        primaryData={[
          { date: "2026-03-01", value: 10 },
          { date: "2026-03-02", value: 20 },
        ]}
        comparisonData={null}
        metric="spend"
        metricLabel="Spend"
      />,
    );
    const wrapper = container.querySelector(".trend-chart-wrapper");
    expect(wrapper).not.toBeNull();
  });

  it("renders a ResponsiveContainer (recharts)", () => {
    const { container } = render(
      <TrendChartInner
        primaryData={[
          { date: "2026-03-01", value: 10 },
          { date: "2026-03-02", value: 20 },
        ]}
        comparisonData={null}
        metric="spend"
        metricLabel="Spend"
      />,
    );
    // ResponsiveContainer renders a div with class recharts-responsive-container
    const rc = container.querySelector(".recharts-responsive-container");
    expect(rc).not.toBeNull();
  });
});
