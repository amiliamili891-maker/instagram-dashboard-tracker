"use client";

import Link from "next/link";
import { fmt } from "@/lib/format-utils";
import { SparklineCell } from "@/components/sparkline-cell";
import { Badge } from "@/components/badge";
import { useTableSort } from "@/hooks/use-table-sort";
import { SortableTh } from "@/components/sortable-th";
import type { TierLabel, TierColor } from "@/lib/intelligence/tier-classifier";
import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Common row shape shared by all entity tables */
export interface EntityRow {
  id: string;
  name: string;
  spend: number;
  impressions: number;
  clicks: number;
  chats: number;
  visits: number;
  reveals: number;
  cost_per_chat: number | null;
  chat_rate: number | null;
  reveal_rate: number | null;
  dailyCostPerChat: (number | null)[];
}

export interface TierInfo {
  tier: TierLabel;
  color: TierColor;
}

export interface EntityTableProps {
  rows: EntityRow[];
  tiers: Map<string, TierInfo>;
  /** Period string used for building links (e.g. "7d") */
  period: string;
  /** Function to build the drill-down link href for each row */
  buildHref: (row: EntityRow, period: string) => string;
  /** Optional function to render a thumbnail before the name column (for ads table) */
  renderThumbnail?: (row: EntityRow) => ReactNode;
  /** Label for the name column header (e.g. "Campaign", "Adset", "Ad") */
  nameLabel: string;
  /** Message shown when rows is empty */
  emptyMessage?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Shared entity table with sorting, sparklines, and tier badges.
 * Used by campaign list, campaign detail (adsets), and adset detail (ads).
 */
export function EntityTable({
  rows,
  tiers,
  period,
  buildHref,
  renderThumbnail,
  nameLabel,
  emptyMessage = "No data found for this period.",
}: EntityTableProps) {
  const { sortedRows, sortKey, sortDir, onSort } = useTableSort<EntityRow, keyof EntityRow>(
    rows,
    "spend",
    "desc",
  );

  if (rows.length === 0) {
    return <div className="table-empty">{emptyMessage}</div>;
  }

  const sortProps = {
    activeSortKey: sortKey as string,
    sortDir,
    onSort: onSort as (key: string) => void,
  };

  return (
    <div className="table-wrapper">
      <table className="data-table">
        <thead>
          <tr>
            {renderThumbnail && <th className="thumbnail-cell"></th>}
            <SortableTh label={nameLabel} sortKey="name" {...sortProps} />
            <th>Tier</th>
            <th>Cost/Chat Trend</th>
            <SortableTh label="Spend" sortKey="spend" {...sortProps} />
            <SortableTh label="Cost/Chat" sortKey="cost_per_chat" {...sortProps} />
            <SortableTh label="Chat Rate" sortKey="chat_rate" {...sortProps} />
            <SortableTh label="Reveal Rate" sortKey="reveal_rate" {...sortProps} />
            <SortableTh label="Chats" sortKey="chats" {...sortProps} />
            <SortableTh label="Visits" sortKey="visits" {...sortProps} />
            <SortableTh label="Reveals" sortKey="reveals" {...sortProps} />
            <SortableTh label="Impressions" sortKey="impressions" {...sortProps} />
            <SortableTh label="Clicks" sortKey="clicks" {...sortProps} />
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => {
            const tierInfo = tiers.get(row.id);
            return (
              <tr key={row.id}>
                {renderThumbnail && (
                  <td className="thumbnail-cell">{renderThumbnail(row)}</td>
                )}
                <td>
                  <Link
                    href={buildHref(row, period)}
                    className="entity-link"
                  >
                    {row.name}
                  </Link>
                </td>
                <td>
                  {tierInfo ? (
                    <Badge variant="tier" tier={tierInfo.tier} color={tierInfo.color} />
                  ) : (
                    <span className="tier-badge tier-gray">--</span>
                  )}
                </td>
                <td className="sparkline-cell">
                  {row.dailyCostPerChat.length >= 2 ? (
                    <SparklineCell data={row.dailyCostPerChat} />
                  ) : (
                    <span style={{ color: "var(--muted)", fontSize: "0.75rem" }}>--</span>
                  )}
                </td>
                <td>{fmt(row.spend, "currency")}</td>
                <td>{fmt(row.cost_per_chat, "currency")}</td>
                <td>{fmt(row.chat_rate, "percent")}</td>
                <td>{fmt(row.reveal_rate, "percent")}</td>
                <td>{fmt(row.chats, "number")}</td>
                <td>{fmt(row.visits, "number")}</td>
                <td>{fmt(row.reveals, "number")}</td>
                <td>{fmt(row.impressions, "number")}</td>
                <td>{fmt(row.clicks, "number")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
