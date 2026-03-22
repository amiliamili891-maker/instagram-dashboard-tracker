"use client";

import type { SortDir } from "@/hooks/use-table-sort";

interface SortableThProps {
  label: string;
  sortKey: string;
  activeSortKey: string;
  sortDir: SortDir;
  onSort: (key: string) => void;
  className?: string;
}

/**
 * Clickable table header cell with sort indicators.
 * Shows ▲/▼ for active column, dimmed ▲▼ for inactive columns on hover.
 */
export function SortableTh({
  label,
  sortKey,
  activeSortKey,
  sortDir,
  onSort,
  className,
}: SortableThProps) {
  const isActive = sortKey === activeSortKey;

  return (
    <th
      scope="col"
      className={`sortable-th ${className ?? ""}`}
      onClick={() => onSort(sortKey)}
    >
      {label}
      <span className={`sort-indicator ${isActive ? "active" : ""}`}>
        {isActive ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
      </span>
    </th>
  );
}
