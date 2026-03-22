import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ScorecardSkeleton } from "@/components/scorecard-table";

describe("ScorecardSkeleton", () => {
  it("renders a skeleton table with 13 columns and 8 rows", () => {
    const { container } = render(<ScorecardSkeleton />);
    const headerCells = container.querySelectorAll("thead th");
    expect(headerCells).toHaveLength(13);

    const bodyRows = container.querySelectorAll("tbody tr");
    expect(bodyRows).toHaveLength(8);
  });
});
