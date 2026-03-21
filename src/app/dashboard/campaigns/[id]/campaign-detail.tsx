"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { getDateRanges, isValidPeriod } from "@/lib/date-utils";
import { fmt } from "@/lib/format-utils";

interface AdsetRow {
  adset_id: string;
  adset_name: string;
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

export function CampaignDetail({ campaignId }: { campaignId: string }) {
  const searchParams = useSearchParams();
  const periodParam = searchParams.get("period");
  const period = isValidPeriod(periodParam) ? periodParam : "7d";
  const [campaignName, setCampaignName] = useState(campaignId);
  const [rows, setRows] = useState<AdsetRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const { current: range } = getDateRanges(period);

    // Fetch adset-level stats for this campaign
    // We need to get adset-level data, then filter to those belonging to this campaign
    // Since combined_stats stores entity_id as the adset_id at adset level,
    // we need to cross-reference with the adsets table.
    // Approach: fetch ad-level stats and group by adset.
    fetch(
      `/api/stats/combined?level=ad&date_from=${range.from}&date_to=${range.to}`,
    )
      .then((r) => r.json())
      .then(async (resp) => {
        const allAdStats: Record<string, unknown>[] = resp.data ?? [];

        // We need to know which ads belong to this campaign's adsets
        // Fetch ads for this campaign
        const adsResp = await fetch(`/api/entity/ads?campaign_id=${campaignId}`);
        let adsData: { id: string; name: string; adset_id: string }[] = [];
        let adsetsData: { id: string; name: string }[] = [];
        let campName = campaignId;

        if (adsResp.ok) {
          const adsJson = await adsResp.json();
          adsData = adsJson.ads ?? [];
          adsetsData = adsJson.adsets ?? [];
          campName = adsJson.campaign_name ?? campaignId;
        }

        setCampaignName(campName);

        const adIdsInCampaign = new Set(adsData.map((a) => a.id));
        const adToAdset = new Map(adsData.map((a) => [a.id, a.adset_id]));
        const adsetNames = new Map(adsetsData.map((a) => [a.id, a.name]));

        // Filter stats to ads in this campaign and group by adset
        const adsetAgg = new Map<string, { spend: number; impressions: number; clicks: number; chats: number; visits: number; reveals: number }>();
        for (const row of allAdStats) {
          const entityId = row.entity_id as string;
          if (!adIdsInCampaign.has(entityId)) continue;
          const adsetId = adToAdset.get(entityId) ?? "unknown";
          const existing = adsetAgg.get(adsetId) ?? { spend: 0, impressions: 0, clicks: 0, chats: 0, visits: 0, reveals: 0 };
          existing.spend += Number(row.spend) || 0;
          existing.impressions += Number(row.impressions) || 0;
          existing.clicks += Number(row.clicks) || 0;
          existing.chats += Number(row.chats) || 0;
          existing.visits += Number(row.visits) || 0;
          existing.reveals += Number(row.reveals) || 0;
          adsetAgg.set(adsetId, existing);
        }

        const result: AdsetRow[] = Array.from(adsetAgg.entries()).map(
          ([adsetId, a]) => ({
            adset_id: adsetId,
            adset_name: adsetNames.get(adsetId) ?? adsetId,
            spend: a.spend,
            impressions: a.impressions,
            clicks: a.clicks,
            chats: a.chats,
            visits: a.visits,
            reveals: a.reveals,
            cost_per_chat: a.chats > 0 ? a.spend / a.chats : null,
            chat_rate: a.visits > 0 ? a.chats / a.visits : null,
            reveal_rate: a.chats > 0 ? a.reveals / a.chats : null,
          }),
        );
        result.sort((a, b) => b.spend - a.spend);
        setRows(result);
        setLoading(false);
      })
      .catch(() => {
        setRows([]);
        setLoading(false);
      });
  }, [period, campaignId]);

  if (loading) return <div className="table-loading">Loading adsets...</div>;

  return (
    <>
      <div className="breadcrumb">
        <Link href={`/dashboard/campaigns?period=${period}`}>Campaigns</Link>
        <span className="breadcrumb-sep">/</span>
        <span>{campaignName}</span>
      </div>
      <h1 className="page-title">{campaignName}</h1>
      <h2 className="section-title">Adsets</h2>

      {rows.length === 0 ? (
        <div className="table-empty">No adsets found for this campaign and period.</div>
      ) : (
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
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
              {rows.map((row) => (
                <tr key={row.adset_id}>
                  <td>
                    <Link
                      href={`/dashboard/adsets/${row.adset_id}?period=${period}`}
                      className="entity-link"
                    >
                      {row.adset_name}
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
