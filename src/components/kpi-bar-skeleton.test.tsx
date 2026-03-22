import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { KpiBarSkeleton } from "@/components/kpi-bar";

describe("KpiBarSkeleton", () => {
  it("renders default 5 skeleton cards", () => {
    const { container } = render(<KpiBarSkeleton />);
    const cards = container.querySelectorAll(".kpi-card-skeleton");
    expect(cards).toHaveLength(5);
  });

  it("renders custom count of skeleton cards", () => {
    const { container } = render(<KpiBarSkeleton count={3} />);
    const cards = container.querySelectorAll(".kpi-card-skeleton");
    expect(cards).toHaveLength(3);
  });

  it("has accessible role and label", () => {
    render(<KpiBarSkeleton />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-label", "Loading KPI data");
  });

  it("renders 3 skeleton cells per card (label, value, delta)", () => {
    const { container } = render(<KpiBarSkeleton count={1} />);
    const cells = container.querySelectorAll(".skeleton-cell");
    expect(cells).toHaveLength(3);
  });
});
