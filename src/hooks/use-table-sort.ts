"use client";

import { useState, useMemo } from "react";

export type SortDir = "asc" | "desc";

export interface SortState<K> {
  sortKey: K;
  sortDir: SortDir;
}

export interface UseTableSortResult<T, K extends keyof T> {
  sortedRows: T[];
  sortKey: K;
  sortDir: SortDir;
  onSort: (key: K) => void;
}

/**
 * Generic table sorting hook.
 *
 * - Clicking a new column sorts it in `defaultDir`
 * - Clicking the same column toggles direction
 * - null/undefined values sort to the bottom regardless of direction
 * - Detects numeric vs string comparison automatically
 */
export function useTableSort<T, K extends keyof T = keyof T>(
  rows: T[],
  defaultKey: K,
  defaultDir: SortDir = "desc",
): UseTableSortResult<T, K> {
  const [sortKey, setSortKey] = useState<K>(defaultKey);
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir);

  const onSort = (key: K) => {
    if (key === sortKey) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(defaultDir);
    }
  };

  const sortedRows = useMemo(() => {
    if (rows.length === 0) return rows;

    return [...rows].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];

      // Nulls/undefined always sort to bottom
      const aNull = aVal === null || aVal === undefined;
      const bNull = bVal === null || bVal === undefined;
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;

      let cmp: number;
      if (typeof aVal === "number" && typeof bVal === "number") {
        cmp = aVal - bVal;
      } else if (typeof aVal === "string" && typeof bVal === "string") {
        cmp = aVal.localeCompare(bVal);
      } else {
        // Fallback: coerce to string
        cmp = String(aVal).localeCompare(String(bVal));
      }

      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [rows, sortKey, sortDir]);

  return { sortedRows, sortKey, sortDir, onSort };
}
