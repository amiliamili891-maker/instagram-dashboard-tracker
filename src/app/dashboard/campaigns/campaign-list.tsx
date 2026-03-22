"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getDateRanges, isValidPeriod } from "@/lib/date-utils";
import { EntityTable, type EntityRow, type TierInfo } from "@/components/entity-table";
import type { TierLabel, TierColor } from "@/lib/intelligence/tier-classifier";

export function CampaignList() {
  const searchParams = useSearchParams();
  const periodParam = searchParams.get("period");
  const period = isValidPeriod(periodParam) ? periodParam : "7d";
  const [rows, setRows] = useState<EntityRow[]>([]);
  const [tiers, setTiers] = useState<Map<string, TierInfo>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const { current: range } = getDateRanges(period);

    // Parallel fetch: stats + names + tiers
    Promise.all([
      fetch(`/api/stats/combined?level=campaign&date_from=${range.from}&date_to=${range.to}`).then((r) => r.json()),
      fetch('/api/entity/campaigns').then((r) => r.ok ? r.json() : { campaigns: [] }).catch(() => ({ campaigns: [] })),
      fetch('/api/intelligence/tiers?level=campaign').then((r) => r.ok ? r.json() : { data: [] }).catch(() => ({ data: [] })),
    ])
      .then(([resp, namesJson, tiersJson]) => {
        const data: Record<string, unknown>[] = resp.data ?? [];
        const campaigns: { id: string; name: string }[] = namesJson.campaigns ?? [];
        const nameMap = new Map(campaigns.map((c: { id: string; name: string }) => [c.id, c.name]));

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

        // Aggregate by entity_id across dates, and collect daily data for sparklines
        const agg = new Map<string, { spend: number; impressions: number; clicks: number; chats: number; visits: number; reveals: number }>();
        // Daily breakdown: entity_id -> date -> { spend, chats }
        const daily = new Map<string, Map<string, { spend: number; chats: number }>>();

        for (const row of data) {
          const id = row.entity_id as string;
          const date = row.report_date as string;

          const existing = agg.get(id) ?? { spend: 0, impressions: 0, clicks: 0, chats: 0, visits: 0, reveals: 0 };
          existing.spend += Number(row.spend) || 0;
          existing.impressions += Number(row.impressions) || 0;
          existing.clicks += Number(row.clicks) || 0;
          existing.chats += Number(row.chats) || 0;
          existing.visits += Number(row.visits) || 0;
          existing.reveals += Number(row.reveals) || 0;
          agg.set(id, existing);

          // Daily data for sparklines
          if (!daily.has(id)) daily.set(id, new Map());
          const dayMap = daily.get(id)!;
          const dayData = dayMap.get(date) ?? { spend: 0, chats: 0 };
          dayData.spend += Number(row.spend) || 0;
          dayData.chats += Number(row.chats) || 0;
          dayMap.set(date, dayData);
        }

        const ids = Array.from(agg.keys());

        const result: EntityRow[] = ids.map((id) => {
          const a = agg.get(id)!;

          // Build sparkline: daily cost_per_chat, sorted chronologically
          const dayMap = daily.get(id);
          let dailyCostPerChat: (number | null)[] = [];
          if (dayMap) {
            const sortedDates = Array.from(dayMap.keys()).sort();
            dailyCostPerChat = sortedDates.map((d) => {
              const dd = dayMap.get(d)!;
              return dd.chats > 0 ? dd.spend / dd.chats : null;
            });
          }

          return {
            id,
            name: nameMap.get(id) ?? id,
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
  }, [period]);

  if (loading) return <div className="table-loading">Loading campaigns...</div>;

  return (
    <EntityTable
      rows={rows}
      tiers={tiers}
      period={period}
      nameLabel="Campaign"
      buildHref={(row, p) => `/dashboard/campaigns/${row.id}?period=${p}`}
      emptyMessage="No campaigns found for this period."
    />
  );
}
