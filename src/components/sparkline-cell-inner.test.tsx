import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { SparklineCellInner } from "@/components/sparkline-cell-inner";

describe("SparklineCellInner", () => {
  it("renders an SVG chart", () => {
    const { container } = render(
      <SparklineCellInner data={[1, 2, 3, 4, 5]} />,
    );
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
  });

  it("uses accent color for uptrend", () => {
    const { container } = render(
      <SparklineCellInner data={[1, 5]} />,
    );
    const line = container.querySelector(".recharts-line-curve");
    expect(line).not.toBeNull();
    expect(line?.getAttribute("stroke")).toContain("accent");
  });

  it("uses danger color for downtrend", () => {
    const { container } = render(
      <SparklineCellInner data={[5, 1]} />,
    );
    const line = container.querySelector(".recharts-line-curve");
    expect(line).not.toBeNull();
    expect(line?.getAttribute("stroke")).toContain("danger");
  });
});
