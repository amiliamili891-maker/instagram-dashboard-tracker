"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { getDateRanges, isValidPeriod } from "@/lib/date-utils";

interface AdRow {
  ad_id: string;
  ad_name: string;
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

export function AdsetDetail({ adsetId }: { adsetId: string }) {
  const searchParams = useSearchParams();
  const periodParam = searchParams.get("period");
  const period = isValidPeriod(periodParam) ? periodParam : "7d";
  const [adsetName, setAdsetName] = useState(adsetId);
  const [campaignId, setCampaignId] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [rows, setRows] = useState<AdRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const { current: range } = getDateRanges(period);

    fetch(
      `/api/stats/combined?level=ad&date_from=${range.from}&date_to=${range.to}`,
    )
      .then((r) => r.json())
      .then(async (resp) => {
        const allAdStats: Record<string, unknown>[] = resp.data ?? [];

        // Fetch ads for this adset
        const adsResp = await fetch(`/api/entity/ads-by-adset?adset_id=${adsetId}`);
        let adsData: { id: string; name: string; campaign_id: string }[] = [];
        let asName = adsetId;
        let campId = "";

        let campName = "";
        if (adsResp.ok) {
          const adsJson = await adsResp.json();
          adsData = adsJson.ads ?? [];
          asName = adsJson.adset_name ?? adsetId;
          campId = adsJson.campaign_id ?? "";
          campName = adsJson.campaign_name ?? "";
        }

        setAdsetName(asName);
        setCampaignId(campId);
        setCampaignName(campName);

        const adIdsInAdset = new Set(adsData.map((a) => a.id));
        const adNames = new Map(adsData.map((a) => [a.id, a.name]));

        // Aggregate by ad_id across dates
        const adAgg = new Map<string, { spend: number; impressions: number; clicks: number; chats: number; visits: number; reveals: number }>();
        for (const row of allAdStats) {
          const entityId = row.entity_id as string;
          if (!adIdsInAdset.has(entityId)) continue;
          const existing = adAgg.get(entityId) ?? { spend: 0, impressions: 0, clicks: 0, chats: 0, visits: 0, reveals: 0 };
          existing.spend += Number(row.spend) || 0;
          existing.impressions += Number(row.impressions) || 0;
          existing.clicks += Number(row.clicks) || 0;
          existing.chats += Number(row.chats) || 0;
          existing.visits += Number(row.visits) || 0;
          existing.reveals += Number(row.reveals) || 0;
          adAgg.set(entityId, existing);
        }

        const result: AdRow[] = Array.from(adAgg.entries()).map(([adId, a]) => ({
          ad_id: adId,
          ad_name: adNames.get(adId) ?? adId,
          spend: a.spend,
          impressions: a.impressions,
          clicks: a.clicks,
          chats: a.chats,
          visits: a.visits,
          reveals: a.reveals,
          cost_per_chat: a.chats > 0 ? a.spend / a.chats : null,
          chat_rate: a.visits > 0 ? a.chats / a.visits : null,
          reveal_rate: a.chats > 0 ? a.reveals / a.chats : null,
        }));
        result.sort((a, b) => b.spend - a.spend);
        setRows(result);
        setLoading(false);
      })
      .catch(() => {
        setRows([]);
        setLoading(false);
      });
  }, [period, adsetId]);

  if (loading) return <div className="table-loading">Loading ads...</div>;

  return (
    <>
      <div className="breadcrumb">
        <Link href={`/dashboard/campaigns?period=${period}`}>Campaigns</Link>
        <span className="breadcrumb-sep">/</span>
        {campaignId && (
          <>
            <Link href={`/dashboard/campaigns/${campaignId}?period=${period}`}>
              {campaignName || "Campaign"}
            </Link>
            <span className="breadcrumb-sep">/</span>
          </>
        )}
        <span>{adsetName}</span>
      </div>
      <h1 className="page-title">{adsetName}</h1>
      <h2 className="section-title">Ads</h2>

      {rows.length === 0 ? (
        <div className="table-empty">No ads found for this adset and period.</div>
      ) : (
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Ad</th>
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
                <tr key={row.ad_id}>
                  <td>
                    <Link
                      href={`/dashboard/ads/${row.ad_id}?period=${period}`}
                      className="entity-link"
                    >
                      {row.ad_name}
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
      )}
    </>
  );
}
