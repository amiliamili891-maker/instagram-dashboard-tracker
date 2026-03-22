"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { getDateRanges, isValidPeriod } from "@/lib/date-utils";
import { EntityTable, type EntityRow, type TierInfo } from "@/components/entity-table";
import { ImageLightbox } from "@/components/image-lightbox";
import type { TierLabel, TierColor } from "@/lib/intelligence/tier-classifier";

export function AdsetDetail({ adsetId }: { adsetId: string }) {
  const searchParams = useSearchParams();
  const periodParam = searchParams.get("period");
  const period = isValidPeriod(periodParam) ? periodParam : "7d";
  const [adsetName, setAdsetName] = useState(adsetId);
  const [campaignId, setCampaignId] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [rows, setRows] = useState<EntityRow[]>([]);
  const [tiers, setTiers] = useState<Map<string, TierInfo>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const { current: range } = getDateRanges(period);

    // Parallel fetch: stats + entity metadata + ad tiers
    Promise.all([
      fetch(`/api/stats/combined?level=ad&date_from=${range.from}&date_to=${range.to}`).then((r) => r.json()),
      fetch(`/api/entity/ads-by-adset?adset_id=${adsetId}`).then((r) => r.ok ? r.json() : { ads: [], adset_name: adsetId, campaign_id: "", campaign_name: "" }),
      fetch('/api/intelligence/tiers?level=ad').then((r) => r.ok ? r.json() : { data: [] }).catch(() => ({ data: [] })),
    ])
      .then(([resp, adsJson, tiersJson]) => {
        const allAdStats: Record<string, unknown>[] = resp.data ?? [];
        const adsData: { id: string; name: string; campaign_id: string }[] = adsJson.ads ?? [];

        setAdsetName(adsJson.adset_name ?? adsetId);
        setCampaignId(adsJson.campaign_id ?? "");
        setCampaignName(adsJson.campaign_name ?? "");

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

        const adIdsInAdset = new Set(adsData.map((a) => a.id));
        const adNames = new Map(adsData.map((a) => [a.id, a.name]));

        // Aggregate by ad_id across dates and collect daily data
        const adAgg = new Map<string, { spend: number; impressions: number; clicks: number; chats: number; visits: number; reveals: number }>();
        const daily = new Map<string, Map<string, { spend: number; chats: number }>>();

        for (const row of allAdStats) {
          const entityId = row.entity_id as string;
          if (!adIdsInAdset.has(entityId)) continue;
          const date = row.report_date as string;

          const existing = adAgg.get(entityId) ?? { spend: 0, impressions: 0, clicks: 0, chats: 0, visits: 0, reveals: 0 };
          existing.spend += Number(row.spend) || 0;
          existing.impressions += Number(row.impressions) || 0;
          existing.clicks += Number(row.clicks) || 0;
          existing.chats += Number(row.chats) || 0;
          existing.visits += Number(row.visits) || 0;
          existing.reveals += Number(row.reveals) || 0;
          adAgg.set(entityId, existing);

          // Daily data
          if (!daily.has(entityId)) daily.set(entityId, new Map());
          const dayMap = daily.get(entityId)!;
          const dayData = dayMap.get(date) ?? { spend: 0, chats: 0 };
          dayData.spend += Number(row.spend) || 0;
          dayData.chats += Number(row.chats) || 0;
          dayMap.set(date, dayData);
        }

        const result: EntityRow[] = Array.from(adAgg.entries()).map(([adId, a]) => {
          const dayMap = daily.get(adId);
          let dailyCostPerChat: (number | null)[] = [];
          if (dayMap) {
            const sortedDates = Array.from(dayMap.keys()).sort();
            dailyCostPerChat = sortedDates.map((d) => {
              const dd = dayMap.get(d)!;
              return dd.chats > 0 ? dd.spend / dd.chats : null;
            });
          }

          return {
            id: adId,
            name: adNames.get(adId) ?? adId,
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
        });
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

      <EntityTable
        rows={rows}
        tiers={tiers}
        period={period}
        nameLabel="Ad"
        buildHref={(row, p) => `/dashboard/ads/${row.id}?period=${p}`}
        renderThumbnail={(row) => <ImageLightbox adId={row.id} size="sm" />}
        emptyMessage="No ads found for this adset and period."
      />
    </>
  );
}
