import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTableSort } from "./use-table-sort";

interface TestRow {
  name: string;
  spend: number | null;
  rate: number | null;
}

const rows: TestRow[] = [
  { name: "Alpha", spend: 100, rate: 0.5 },
  { name: "Beta", spend: 200, rate: null },
  { name: "Gamma", spend: null, rate: 0.3 },
  { name: "Delta", spend: 50, rate: 0.8 },
];

describe("useTableSort", () => {
  it("sorts by default key and direction", () => {
    const { result } = renderHook(() =>
      useTableSort<TestRow, keyof TestRow>(rows, "spend", "desc"),
    );
    const names = result.current.sortedRows.map((r) => r.name);
    // 200, 100, 50, then null last
    expect(names).toEqual(["Beta", "Alpha", "Delta", "Gamma"]);
    expect(result.current.sortKey).toBe("spend");
    expect(result.current.sortDir).toBe("desc");
  });

  it("sorts ascending", () => {
    const { result } = renderHook(() =>
      useTableSort<TestRow, keyof TestRow>(rows, "spend", "asc"),
    );
    const names = result.current.sortedRows.map((r) => r.name);
    // 50, 100, 200, then null last
    expect(names).toEqual(["Delta", "Alpha", "Beta", "Gamma"]);
  });

  it("toggles direction on same-key click", () => {
    const { result } = renderHook(() =>
      useTableSort<TestRow, keyof TestRow>(rows, "spend", "desc"),
    );
    act(() => result.current.onSort("spend"));
    expect(result.current.sortDir).toBe("asc");
    const names = result.current.sortedRows.map((r) => r.name);
    expect(names).toEqual(["Delta", "Alpha", "Beta", "Gamma"]);
  });

  it("resets to default direction on new-key click", () => {
    const { result } = renderHook(() =>
      useTableSort<TestRow, keyof TestRow>(rows, "spend", "desc"),
    );
    // Toggle to asc
    act(() => result.current.onSort("spend"));
    expect(result.current.sortDir).toBe("asc");
    // Click a new column — should reset to desc (default)
    act(() => result.current.onSort("name"));
    expect(result.current.sortKey).toBe("name");
    expect(result.current.sortDir).toBe("desc");
  });

  it("sorts strings correctly", () => {
    const { result } = renderHook(() =>
      useTableSort<TestRow, keyof TestRow>(rows, "name", "asc"),
    );
    const names = result.current.sortedRows.map((r) => r.name);
    expect(names).toEqual(["Alpha", "Beta", "Delta", "Gamma"]);
  });

  it("handles all-null columns", () => {
    const nullRows: TestRow[] = [
      { name: "A", spend: null, rate: null },
      { name: "B", spend: null, rate: null },
    ];
    const { result } = renderHook(() =>
      useTableSort<TestRow, keyof TestRow>(nullRows, "spend", "desc"),
    );
    // Should not crash, order is stable
    expect(result.current.sortedRows).toHaveLength(2);
  });

  it("handles empty arrays", () => {
    const { result } = renderHook(() =>
      useTableSort<TestRow, keyof TestRow>([], "spend", "desc"),
    );
    expect(result.current.sortedRows).toEqual([]);
  });

  it("places nulls at bottom regardless of direction", () => {
    const { result } = renderHook(() =>
      useTableSort<TestRow, keyof TestRow>(rows, "rate", "asc"),
    );
    const names = result.current.sortedRows.map((r) => r.name);
    // 0.3, 0.5, 0.8, then null last
    expect(names).toEqual(["Gamma", "Alpha", "Delta", "Beta"]);

    act(() => result.current.onSort("rate")); // toggle to desc
    const namesDesc = result.current.sortedRows.map((r) => r.name);
    // 0.8, 0.5, 0.3, then null last
    expect(namesDesc).toEqual(["Delta", "Alpha", "Gamma", "Beta"]);
  });
});
