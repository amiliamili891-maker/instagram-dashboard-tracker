import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SkeletonTable } from "@/components/skeleton-table";

describe("SkeletonTable", () => {
  it("renders default 5 rows and 6 columns with header", () => {
    const { container } = render(<SkeletonTable />);
    const rows = container.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(5);

    const headerCells = container.querySelectorAll("thead th");
    expect(headerCells).toHaveLength(6);
  });

  it("renders custom row and column counts", () => {
    const { container } = render(<SkeletonTable rows={3} columns={4} />);
    const rows = container.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(3);

    // Each row should have 4 cells
    const firstRowCells = rows[0].querySelectorAll("td");
    expect(firstRowCells).toHaveLength(4);
  });

  it("hides header when showHeader is false", () => {
    const { container } = render(<SkeletonTable showHeader={false} />);
    const thead = container.querySelector("thead");
    expect(thead).toBeNull();
  });

  it("has accessible role and label", () => {
    render(<SkeletonTable />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-label", "Loading table data");
  });

  it("renders skeleton-cell divs inside each cell", () => {
    const { container } = render(<SkeletonTable rows={2} columns={3} />);
    const cells = container.querySelectorAll("tbody .skeleton-cell");
    expect(cells).toHaveLength(6);
  });
});
