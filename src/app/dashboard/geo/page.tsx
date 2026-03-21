/**
 * /dashboard/geo — Geo Breakdown Page
 *
 * Shows city/region/country breakdown from sessions table.
 * Includes session count, chat_rate, reveal_rate, and sample size.
 *
 * Auth is handled by the dashboard layout (requireAdminUser).
 */

import { getServerEnv } from '@/lib/env';
import { createServiceClient } from '@/lib/supabase/service';
import { GeoControls } from './geo-controls';

export const dynamic = 'force-dynamic';

function getDefaultDates() {
  const now = new Date();
  const to = now.toISOString().split('T')[0];
  const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  return { from, to };
}

interface GeoRow {
  location: string;
  sessions: number;
  chatted: number;
  chat_rate: number | null;
  revealed: number;
  reveal_rate: number | null;
  clicked: number;
  converted: number;
}

const VALID_GROUP_BY = ['city', 'region', 'country'] as const;

async function fetchGeoData(opts: {
  groupBy: string;
  dateFrom: string;
  dateTo: string;
  campaignId?: string;
  adsetId?: string;
  adId?: string;
}): Promise<{ data: GeoRow[]; totalSessions: number }> {
  const supabase = createServiceClient();
  const groupCol = VALID_GROUP_BY.includes(opts.groupBy as typeof VALID_GROUP_BY[number])
    ? opts.groupBy
    : 'country';

  // Use Supabase RPC for server-side GROUP BY aggregation
  const { data, error } = await supabase.rpc('geo_breakdown', {
    p_group_by: groupCol,
    p_date_from: `${opts.dateFrom}T00:00:00Z`,
    p_date_to: `${opts.dateTo}T23:59:59Z`,
    p_campaign_id: opts.campaignId ?? null,
    p_adset_id: opts.adsetId ?? null,
    p_ad_id: opts.adId ?? null,
  });

  if (error || !data) {
    // Fallback: return empty
    console.error('Geo RPC error:', error?.message);
    return { data: [], totalSessions: 0 };
  }

  let totalSessions = 0;
  const geoData: GeoRow[] = (data as Array<Record<string, unknown>>).map((row) => {
    const sessions = Number(row.sessions) || 0;
    const chatted = Number(row.chatted) || 0;
    const revealed = Number(row.revealed) || 0;
    totalSessions += sessions;
    return {
      location: (row.location as string) || '(unknown)',
      sessions,
      chatted,
      chat_rate: sessions > 0 ? chatted / sessions : null,
      revealed,
      reveal_rate: chatted > 0 ? revealed / chatted : null,
      clicked: Number(row.clicked) || 0,
      converted: Number(row.converted) || 0,
    };
  });

  geoData.sort((a, b) => b.sessions - a.sessions);
  return { data: geoData, totalSessions };
}

function formatRate(value: number | null): string {
  if (value === null) return '-';
  return `${(value * 100).toFixed(1)}%`;
}

export default async function GeoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedParams = await searchParams;
  const defaults = getDefaultDates();
  const groupBy = (typeof resolvedParams.group_by === 'string' ? resolvedParams.group_by : null) ?? 'country';
  const dateFrom = (typeof resolvedParams.date_from === 'string' ? resolvedParams.date_from : null) ?? defaults.from;
  const dateTo = (typeof resolvedParams.date_to === 'string' ? resolvedParams.date_to : null) ?? defaults.to;
  const campaignId = typeof resolvedParams.campaign_id === 'string' ? resolvedParams.campaign_id : undefined;
  const adsetId = typeof resolvedParams.adset_id === 'string' ? resolvedParams.adset_id : undefined;
  const adId = typeof resolvedParams.ad_id === 'string' ? resolvedParams.ad_id : undefined;

  const { data: geoData, totalSessions } = await fetchGeoData({
    groupBy,
    dateFrom,
    dateTo,
    campaignId,
    adsetId,
    adId,
  });

  const groupByLabel = groupBy.charAt(0).toUpperCase() + groupBy.slice(1);

  return (
    <section className="geo-page">
      <header className="geo-header">
        <h1>Geo Breakdown</h1>
        <span className="sample-size">
          {totalSessions.toLocaleString()} total sessions
        </span>
      </header>

      <GeoControls
        currentGroupBy={groupBy}
        dateFrom={dateFrom}
        dateTo={dateTo}
      />

      {geoData.length === 0 ? (
        <p className="empty-state">No geo data available for this period.</p>
      ) : (
        <table className="geo-table">
          <thead>
            <tr>
              <th>{groupByLabel}</th>
              <th>Sessions</th>
              <th>Chatted</th>
              <th>Chat Rate</th>
              <th>Revealed</th>
              <th>Reveal Rate</th>
              <th>Clicked</th>
              <th>Converted</th>
            </tr>
          </thead>
          <tbody>
            {geoData.map((row) => (
              <tr key={row.location}>
                <td>{row.location}</td>
                <td>{row.sessions.toLocaleString()}</td>
                <td>{row.chatted.toLocaleString()}</td>
                <td>{formatRate(row.chat_rate)}</td>
                <td>{row.revealed.toLocaleString()}</td>
                <td>{formatRate(row.reveal_rate)}</td>
                <td>{row.clicked.toLocaleString()}</td>
                <td>{row.converted.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
