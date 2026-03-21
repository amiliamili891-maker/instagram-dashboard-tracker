"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AdThumbnail } from "@/components/ad-thumbnail";

interface AdRow {
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

const MIN_CHATS_THRESHOLD = 5;

function fmt(value: number | null, type: "currency" | "percent" | "number"): string {
  if (value === null || value === undefined) return "\u2013";
  if (type === "currency") return `$${value.toFixed(2)}`;
  if (type === "percent") return `${(value * 100).toFixed(1)}%`;
  return value.toLocaleString();
}

export function ScorecardTable() {
  const searchParams = useSearchParams();
  const period = searchParams.get("period") || "7d";
  const [rows, setRows] = useState<AdRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/stats/scorecard?period=${period}`)
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load scorecard");
        return r.json();
      })
      .then((data) => {
        const loadedRows: AdRow[] = data.rows ?? [];
        setRows(loadedRows);
        setLoading(false);

        // Batch fetch thumbnails
        if (loadedRows.length > 0) {
          const adIds = loadedRows.map((r) => r.entity_id).join(",");
          fetch(`/api/storage/thumbnails?ad_ids=${adIds}`)
            .then((r) => r.json())
            .then((thumbData) => {
              const thumbnails: Record<string, string> = thumbData.thumbnails ?? {};
              setRows((prev) =>
                prev.map((row) => ({
                  ...row,
                  thumbnail_url: thumbnails[row.entity_id],
                })),
              );
            })
            .catch(() => {}); // Non-fatal
        }
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [period]);

  if (loading) {
    return (
      <div className="scorecard-loading">
        <p>Loading scorecard...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="scorecard-error">
        <p>Error: {error}</p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="scorecard-empty">
        <p>No active ads found for this period.</p>
      </div>
    );
  }

  return (
    <div className="scorecard-wrapper">
      <table className="scorecard-table">
        <thead>
          <tr>
            <th>#</th>
            <th></th>
            <th>Ad</th>
            <th>Campaign</th>
            <th>Adset</th>
            <th>Spend</th>
            <th>Cost/Chat</th>
            <th>Chat Rate</th>
            <th>Reveal Rate</th>
            <th>Chats</th>
            <th>Visits</th>
            <th>Reveals</th>
            <th>Impressions</th>
            <th>Clicks</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr
              key={row.entity_id}
              className={row.insufficient_data ? "row-insufficient" : ""}
            >
              <td>{idx + 1}</td>
              <td className="thumbnail-cell">
                <AdThumbnail adId={row.entity_id} signedUrl={row.thumbnail_url} size="sm" />
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

export { MIN_CHATS_THRESHOLD };
