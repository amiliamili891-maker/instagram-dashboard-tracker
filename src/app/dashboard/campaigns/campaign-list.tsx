"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { getDateRanges, isValidPeriod } from "@/lib/date-utils";

interface CampaignRow {
  campaign_id: string;
  campaign_name: string;
  spend: number;
  impressions: number;
  clicks: number;
  chats: number;
  visits: number;
  reveals: number;
  cost_per_chat: number | null;
  chat_rate: number | null;
  reveal_rate: number | null;
}

function fmt(value: number | null, type: "currency" | "percent" | "number"): string {
  if (value === null || value === undefined) return "\u2013";
  if (type === "currency") return `$${value.toFixed(2)}`;
  if (type === "percent") return `${(value * 100).toFixed(1)}%`;
  return value.toLocaleString();
}

export function CampaignList() {
  const searchParams = useSearchParams();
  const periodParam = searchParams.get("period");
  const period = isValidPeriod(periodParam) ? periodParam : "7d";
  const [rows, setRows] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const { current: range } = getDateRanges(period);
    fetch(
      `/api/stats/combined?level=campaign&date_from=${range.from}&date_to=${range.to}`,
    )
      .then((r) => r.json())
      .then(async (resp) => {
        const data: Record<string, unknown>[] = resp.data ?? [];
        // Aggregate by entity_id across dates
        const agg = new Map<string, { spend: number; impressions: number; clicks: number; chats: number; visits: number; reveals: number }>();
        for (const row of data) {
          const id = row.entity_id as string;
          const existing = agg.get(id) ?? { spend: 0, impressions: 0, clicks: 0, chats: 0, visits: 0, reveals: 0 };
          existing.spend += Number(row.spend) || 0;
          existing.impressions += Number(row.impressions) || 0;
          existing.clicks += Number(row.clicks) || 0;
          existing.chats += Number(row.chats) || 0;
          existing.visits += Number(row.visits) || 0;
          existing.reveals += Number(row.reveals) || 0;
          agg.set(id, existing);
        }

        // Fetch campaign names from entity API
        const ids = Array.from(agg.keys());
        let nameMap = new Map<string, string>();
        try {
          const namesResp = await fetch('/api/entity/campaigns');
          if (namesResp.ok) {
            const namesJson = await namesResp.json();
            const campaigns: { id: string; name: string }[] = namesJson.campaigns ?? [];
            nameMap = new Map(campaigns.map((c) => [c.id, c.name]));
          }
        } catch {
          // Silently fall back to showing IDs
        }

        const result: CampaignRow[] = ids.map((id) => {
          const a = agg.get(id)!;
          return {
            campaign_id: id,
            campaign_name: nameMap.get(id) ?? id,
            spend: a.spend,
            impressions: a.impressions,
            clicks: a.clicks,
            chats: a.chats,
            visits: a.visits,
            reveals: a.reveals,
            cost_per_chat: a.chats > 0 ? a.spend / a.chats : null,
            chat_rate: a.visits > 0 ? a.chats / a.visits : null,
            reveal_rate: a.chats > 0 ? a.reveals / a.chats : null,
          };
        });

        result.sort((a, b) => b.spend - a.spend);
        setRows(result);
        setLoading(false);
      })
      .catch(() => {
        setRows([]);
        setLoading(false);
      });
  }, [period]);

  if (loading) return <div className="table-loading">Loading campaigns...</div>;
  if (rows.length === 0) return <div className="table-empty">No campaigns found for this period.</div>;

  return (
    <div className="table-wrapper">
      <table className="data-table">
        <thead>
          <tr>
            <th>Campaign</th>
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
          {rows.map((row) => (
            <tr key={row.campaign_id}>
              <td>
                <Link
                  href={`/dashboard/campaigns/${row.campaign_id}?period=${period}`}
                  className="entity-link"
                >
                  {row.campaign_name}
                </Link>
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
          ))}
        </tbody>
      </table>
    </div>
  );
}
