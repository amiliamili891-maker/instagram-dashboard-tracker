"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { getDateRanges, isValidPeriod } from "@/lib/date-utils";
import { ImageLightbox } from "@/components/image-lightbox";
import { fmt } from "@/lib/format-utils";

interface AdMetrics {
  ad_name: string;
  campaign_id: string;
  campaign_name: string;
  adset_id: string;
  adset_name: string;
  // Meta metrics
  spend: number;
  impressions: number;
  clicks: number;
  unique_clicks: number;
  cpc: number | null;
  cpm: number | null;
  ctr: number | null;
  cost_per_unique_click: number | null;
  meta_conversions: number;
  // Ghstly metrics
  visits: number;
  chats: number;
  reveals: number;
  click_throughs: number;
  ghstly_conversions: number;
  // Derived
  chat_rate: number | null;
  cost_per_chat: number | null;
  reveal_rate: number | null;
  cost_per_reveal: number | null;
  reveal_click_through_rate: number | null;
}

function MetricRow({ label, value, format, source }: { label: string; value: number | null; format: "currency" | "percent" | "number"; source?: string }) {
  return (
    <tr>
      <td className="metric-label">
        {label}
        {source && <span className="source-label">{source}</span>}
      </td>
      <td className="metric-value">{fmt(value, format)}</td>
    </tr>
  );
}

export function AdDetail({ adId }: { adId: string }) {
  const searchParams = useSearchParams();
  const periodParam = searchParams.get("period");
  const period = isValidPeriod(periodParam) ? periodParam : "7d";
  const [metrics, setMetrics] = useState<AdMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const { current: range } = getDateRanges(period);

    Promise.all([
      fetch(`/api/stats/combined?level=ad&date_from=${range.from}&date_to=${range.to}&ad_id=${adId}`).then((r) => r.json()),
      fetch(`/api/entity/ad-detail?ad_id=${adId}`).then((r) => r.json()),
    ])
      .then(([statsResp, entityResp]) => {
        const data: Record<string, unknown>[] = statsResp.data ?? [];

        if (data.length === 0) {
          setMetrics(null);
          setLoading(false);
          return;
        }

        // Aggregate across dates
        const agg = {
          spend: 0, impressions: 0, clicks: 0, unique_clicks: 0,
          visits: 0, chats: 0, reveals: 0, click_throughs: 0,
          ghstly_conversions: 0, meta_conversions: 0,
        };
        for (const row of data) {
          agg.spend += Number(row.spend) || 0;
          agg.impressions += Number(row.impressions) || 0;
          agg.clicks += Number(row.clicks) || 0;
          agg.unique_clicks += Number(row.unique_clicks) || 0;
          agg.visits += Number(row.visits) || 0;
          agg.chats += Number(row.chats) || 0;
          agg.reveals += Number(row.reveals) || 0;
          agg.click_throughs += Number(row.click_throughs) || 0;
          agg.ghstly_conversions += Number(row.ghstly_conversions) || 0;
          agg.meta_conversions += Number(row.meta_conversions) || 0;
        }

        const safeDivide = (n: number, d: number) => d > 0 ? n / d : null;

        setMetrics({
          ad_name: entityResp.ad_name ?? adId,
          campaign_id: entityResp.campaign_id ?? "",
          campaign_name: entityResp.campaign_name ?? "",
          adset_id: entityResp.adset_id ?? "",
          adset_name: entityResp.adset_name ?? "",
          ...agg,
          cpc: safeDivide(agg.spend, agg.clicks),
          cpm: agg.impressions > 0 ? (agg.spend / agg.impressions) * 1000 : null,
          ctr: safeDivide(agg.clicks, agg.impressions),
          cost_per_unique_click: safeDivide(agg.spend, agg.unique_clicks),
          chat_rate: safeDivide(agg.chats, agg.visits),
          cost_per_chat: safeDivide(agg.spend, agg.chats),
          reveal_rate: safeDivide(agg.reveals, agg.chats),
          cost_per_reveal: safeDivide(agg.spend, agg.reveals),
          reveal_click_through_rate: safeDivide(agg.click_throughs, agg.reveals),
        });
        setLoading(false);
      })
      .catch(() => {
        setMetrics(null);
        setLoading(false);
      });
  }, [period, adId]);

  if (loading) return <div className="table-loading">Loading ad detail...</div>;
  if (!metrics) return <div className="table-empty">No data found for this ad and period.</div>;

  return (
    <>
      <div className="breadcrumb">
        <Link href={`/dashboard/campaigns?period=${period}`}>Campaigns</Link>
        <span className="breadcrumb-sep">/</span>
        {metrics.campaign_id && (
          <>
            <Link href={`/dashboard/campaigns/${metrics.campaign_id}?period=${period}`}>
              {metrics.campaign_name || "Campaign"}
            </Link>
            <span className="breadcrumb-sep">/</span>
          </>
        )}
        {metrics.adset_id && (
          <>
            <Link href={`/dashboard/adsets/${metrics.adset_id}?period=${period}`}>
              {metrics.adset_name || "Adset"}
            </Link>
            <span className="breadcrumb-sep">/</span>
          </>
        )}
        <span>{metrics.ad_name}</span>
      </div>
      <div className="ad-detail-header" style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
        <ImageLightbox adId={adId} size="lg" />
        <h1 className="page-title">{metrics.ad_name}</h1>
      </div>

      <div className="metric-sections">
        <div className="metric-section">
          <h3 className="metric-section-title">Meta Metrics</h3>
          <table className="metric-table">
            <tbody>
              <MetricRow label="Spend" value={metrics.spend} format="currency" source="Meta" />
              <MetricRow label="Impressions" value={metrics.impressions} format="number" source="Meta" />
              <MetricRow label="Clicks" value={metrics.clicks} format="number" source="Meta" />
              <MetricRow label="Unique Clicks" value={metrics.unique_clicks} format="number" source="Meta" />
              <MetricRow label="CPC" value={metrics.cpc} format="currency" source="Meta" />
              <MetricRow label="CPM" value={metrics.cpm} format="currency" source="Meta" />
              <MetricRow label="CTR" value={metrics.ctr} format="percent" source="Meta" />
              <MetricRow label="Cost/Unique Click" value={metrics.cost_per_unique_click} format="currency" source="Meta" />
              <MetricRow label="Meta Conversions" value={metrics.meta_conversions} format="number" source="Meta" />
            </tbody>
          </table>
        </div>

        <div className="metric-section">
          <h3 className="metric-section-title">Ghstly Metrics</h3>
          <table className="metric-table">
            <tbody>
              <MetricRow label="Visits" value={metrics.visits} format="number" source="Ghstly" />
              <MetricRow label="Chats" value={metrics.chats} format="number" source="Ghstly" />
              <MetricRow label="Reveals" value={metrics.reveals} format="number" source="Ghstly" />
              <MetricRow label="Click-Throughs" value={metrics.click_throughs} format="number" source="Ghstly" />
              <MetricRow label="Ghstly Conversions" value={metrics.ghstly_conversions} format="number" source="Ghstly" />
            </tbody>
          </table>
        </div>

        <div className="metric-section">
          <h3 className="metric-section-title">Derived Metrics</h3>
          <table className="metric-table">
            <tbody>
              <MetricRow label="Chat Rate" value={metrics.chat_rate} format="percent" />
              <MetricRow label="Cost per Chat" value={metrics.cost_per_chat} format="currency" />
              <MetricRow label="Reveal Rate" value={metrics.reveal_rate} format="percent" />
              <MetricRow label="Cost per Reveal" value={metrics.cost_per_reveal} format="currency" />
              <MetricRow label="Reveal Click-Through Rate" value={metrics.reveal_click_through_rate} format="percent" />
            </tbody>
          </table>
        </div>
      </div>

      <div className="session-link-section">
        <h3 className="metric-section-title">Session Diagnostics</h3>
        <p className="session-link-description">
          Drill into individual user sessions attributed to this ad — see funnel progression, chat transcripts, and drop-off points.
        </p>
        <Link
          href={`/dashboard/sessions?ad_id=${adId}&period=${period}`}
          className="session-diagnostics-btn"
        >
          View {metrics.chats > 0 ? `${metrics.chats} session${metrics.chats !== 1 ? 's' : ''}` : 'sessions'} for this ad
        </Link>
      </div>
    </>
  );
}
