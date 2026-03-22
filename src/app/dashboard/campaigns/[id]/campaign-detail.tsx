// NOTE: The entity table rendering in this file is duplicated in:
//   - src/app/dashboard/campaigns/campaign-list.tsx
//   - src/app/dashboard/adsets/[id]/adset-detail.tsx
// When modifying the table structure, keep all three files in sync.

"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { getDateRanges, isValidPeriod } from "@/lib/date-utils";
import { fmt } from "@/lib/format-utils";
import { SparklineCell } from "@/components/sparkline-cell";
import { TierBadge } from "@/components/tier-badge";
import type { TierLabel, TierColor } from "@/lib/intelligence/tier-classifier";

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
  dailyCostPerChat: (number | null)[];
}

interface TierInfo {
  tier: TierLabel;
  color: TierColor;
}

export function CampaignDetail({ campaignId }: { campaignId: string }) {
  const searchParams = useSearchParams();
  const periodParam = searchParams.get("period");
  const period = isValidPeriod(periodParam) ? periodParam : "7d";
  const [campaignName, setCampaignName] = useState(campaignId);
  const [rows, setRows] = useState<AdsetRow[]>([]);
  const [tiers, setTiers] = useState<Map<string, TierInfo>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const { current: range } = getDateRanges(period);

    // Fetch ad-level stats, entity metadata, and adset tiers in parallel
    Promise.all([
      fetch(`/api/stats/combined?level=ad&date_from=${range.from}&date_to=${range.to}`).then((r) => r.json()),
      fetch(`/api/entity/ads?campaign_id=${campaignId}`).then((r) => r.ok ? r.json() : { ads: [], adsets: [], campaign_name: campaignId }),
      fetch('/api/intelligence/tiers?level=adset').then((r) => r.ok ? r.json() : { data: [] }).catch(() => ({ data: [] })),
    ])
      .then(([resp, adsJson, tiersJson]) => {
        const allAdStats: Record<string, unknown>[] = resp.data ?? [];
        const adsData: { id: string; name: string; adset_id: string }[] = adsJson.ads ?? [];
        const adsetsData: { id: string; name: string }[] = adsJson.adsets ?? [];
        const campName = adsJson.campaign_name ?? campaignId;

        setCampaignName(campName);

        // Build tier map
        const tierMap = new Map<string, TierInfo>();
        for (const t of (tiersJson.data ?? []) as { entity_id: string; data: Record<string, unknown> }[]) {
          const compositeTier = (t.data?.compositeTier as TierLabel) ?? null;
          const compositeColor = (t.data?.compositeColor as TierColor) ?? null;
          if (compositeTier && compositeColor) {
            tierMap.set(t.entity_id, { tier: compositeTier, color: compositeColor });
          }
        }
        setTiers(tierMap);

        const adIdsInCampaign = new Set(adsData.map((a) => a.id));
        const adToAdset = new Map(adsData.map((a) => [a.id, a.adset_id]));
        const adsetNames = new Map(adsetsData.map((a) => [a.id, a.name]));

        // Aggregate by adset and collect daily data for sparklines
        const adsetAgg = new Map<string, { spend: number; impressions: number; clicks: number; chats: number; visits: number; reveals: number }>();
        const daily = new Map<string, Map<string, { spend: number; chats: number }>>();

        for (const row of allAdStats) {
          const entityId = row.entity_id as string;
          if (!adIdsInCampaign.has(entityId)) continue;
          const adsetId = adToAdset.get(entityId) ?? "unknown";
          const date = row.report_date as string;

          const existing = adsetAgg.get(adsetId) ?? { spend: 0, impressions: 0, clicks: 0, chats: 0, visits: 0, reveals: 0 };
          existing.spend += Number(row.spend) || 0;
          existing.impressions += Number(row.impressions) || 0;
          existing.clicks += Number(row.clicks) || 0;
          existing.chats += Number(row.chats) || 0;
          existing.visits += Number(row.visits) || 0;
          existing.reveals += Number(row.reveals) || 0;
          adsetAgg.set(adsetId, existing);

          // Daily data
          if (!daily.has(adsetId)) daily.set(adsetId, new Map());
          const dayMap = daily.get(adsetId)!;
          const dayData = dayMap.get(date) ?? { spend: 0, chats: 0 };
          dayData.spend += Number(row.spend) || 0;
          dayData.chats += Number(row.chats) || 0;
          dayMap.set(date, dayData);
        }

        const result: AdsetRow[] = Array.from(adsetAgg.entries()).map(
          ([adsetId, a]) => {
            const dayMap = daily.get(adsetId);
            let dailyCostPerChat: (number | null)[] = [];
            if (dayMap) {
              const sortedDates = Array.from(dayMap.keys()).sort();
              dailyCostPerChat = sortedDates.map((d) => {
                const dd = dayMap.get(d)!;
                return dd.chats > 0 ? dd.spend / dd.chats : null;
              });
            }

            return {
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
              dailyCostPerChat,
            };
          },
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
                <th>Tier</th>
                <th>Cost/Chat Trend</th>
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
              {rows.map((row) => {
                const tierInfo = tiers.get(row.adset_id);
                return (
                  <tr key={row.adset_id}>
                    <td>
                      <Link
                        href={`/dashboard/adsets/${row.adset_id}?period=${period}`}
                        className="entity-link"
                      >
                        {row.adset_name}
                      </Link>
                    </td>
                    <td>
                      {tierInfo ? (
                        <TierBadge tier={tierInfo.tier} color={tierInfo.color} />
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
      )}
    </>
  );
}
