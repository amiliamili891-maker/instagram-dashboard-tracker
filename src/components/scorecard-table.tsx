"use client";

import Link from "next/link";
import { ImageLightbox } from "@/components/image-lightbox";
import { fmt } from "@/lib/format-utils";
import { useTableSort } from "@/hooks/use-table-sort";
import { SortableTh } from "@/components/sortable-th";

export interface AdRow {
  entity_id: string;
  ad_name: string;
  campaign_name: string;
  adset_name: string;
  campaign_id: string;
  adset_id: string;
  spend: number | null;
  cost_per_chat: number | null;
  chat_rate: number | null;
  reveal_rate: number | null;
  chats: number | null;
  visits: number | null;
  reveals: number | null;
  impressions: number | null;
  clicks: number | null;
  unique_clicks: number | null;
  insufficient_data: boolean;
  thumbnail_url?: string;
}

export function ScorecardTable({
  rows,
  period,
}: {
  rows: AdRow[];
  period: string;
}) {
  const { sortedRows, sortKey, sortDir, onSort } = useTableSort<AdRow, keyof AdRow>(
    rows,
    "cost_per_chat",
    "asc",
  );

  if (rows.length === 0) {
    return (
      <div className="scorecard-empty">
        <p>No active ads found for this period.</p>
      </div>
    );
  }

  const sortProps = { activeSortKey: sortKey as string, sortDir, onSort: onSort as (key: string) => void };

  return (
    <div className="scorecard-wrapper">
      <table className="scorecard-table">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col"></th>
            <SortableTh label="Ad" sortKey="ad_name" {...sortProps} />
            <SortableTh label="Campaign" sortKey="campaign_name" {...sortProps} />
            <SortableTh label="Adset" sortKey="adset_name" {...sortProps} />
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
          {sortedRows.map((row, idx) => (
            <tr
              key={row.entity_id}
              className={row.insufficient_data ? "row-insufficient" : ""}
            >
              <td>{idx + 1}</td>
              <td className="thumbnail-cell">
                <ImageLightbox adId={row.entity_id} thumbnailSignedUrl={row.thumbnail_url} size="sm" />
              </td>
              <td>
                <Link
                  href={`/dashboard/ads/${row.entity_id}?period=${period}`}
                  className="entity-link"
                >
                  {row.ad_name || row.entity_id}
                </Link>
              </td>
              <td>
                <Link
                  href={`/dashboard/campaigns/${row.campaign_id}?period=${period}`}
                  className="entity-link"
                >
                  {row.campaign_name || row.campaign_id}
                </Link>
              </td>
              <td>
                <Link
                  href={`/dashboard/adsets/${row.adset_id}?period=${period}`}
                  className="entity-link"
                >
                  {row.adset_name || row.adset_id}
                </Link>
              </td>
              <td>{fmt(row.spend, "currency")}</td>
              <td>
                {row.insufficient_data ? (
                  <span className="insufficient-label">Insufficient data</span>
                ) : (
                  fmt(row.cost_per_chat, "currency")
                )}
              </td>
              <td>{fmt(row.chat_rate, "percent")}</td>
              <td>{fmt(row.reveal_rate, "percent")}</td>
              <td>{fmt(row.chats, "number")}</td>
              <td>{fmt(row.visits, "number")}</td>
              <td>{fmt(row.reveals, "number")}</td>
              <td>{fmt(row.impressions, "number")}</td>
              <td>{fmt(row.clicks, "number")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
