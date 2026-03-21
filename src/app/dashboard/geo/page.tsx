/**
 * /dashboard/geo — Geo Breakdown Page
 *
 * Shows city/region/country breakdown from sessions table.
 * Includes session count, chat_rate, reveal_rate, and sample size.
 *
 * Auth is handled by the dashboard layout (requireAdminUser).
 */

import { createClient } from '@supabase/supabase-js';
import { getServerEnv } from '@/lib/env';
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

async function fetchGeoData(opts: {
  groupBy: string;
  dateFrom: string;
  dateTo: string;
  campaignId?: string;
  adsetId?: string;
  adId?: string;
}): Promise<{ data: GeoRow[]; totalSessions: number }> {
  const env = getServerEnv();
  const supabase = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let query = supabase
    .from('sessions')
    .select('city, region, country, reached_reveal, clicked_through, converted, messages_count')
    .gte('created_at_utc', `${opts.dateFrom}T00:00:00Z`)
    .lte('created_at_utc', `${opts.dateTo}T23:59:59Z`);

  if (opts.campaignId) query = query.eq('campaign_id', opts.campaignId);
  if (opts.adsetId) query = query.eq('adset_id', opts.adsetId);
  if (opts.adId) query = query.eq('ad_id', opts.adId);

  const { data } = await query;

  const groups = new Map<string, {
    sessions: number;
    chatted: number;
    revealed: number;
    clicked: number;
    converted: number;
  }>();

  for (const row of data ?? []) {
    const groupField = opts.groupBy as 'city' | 'region' | 'country';
    const key = (row[groupField] as string) || '(unknown)';

    if (!groups.has(key)) {
      groups.set(key, { sessions: 0, chatted: 0, revealed: 0, clicked: 0, converted: 0 });
    }

    const entry = groups.get(key)!;
    entry.sessions += 1;
    if (row.messages_count > 0) entry.chatted += 1;
    if (row.reached_reveal) entry.revealed += 1;
    if (row.clicked_through) entry.clicked += 1;
    if (row.converted) entry.converted += 1;
  }

  const geoData = Array.from(groups.entries())
    .map(([location, stats]) => ({
      location,
      sessions: stats.sessions,
      chatted: stats.chatted,
      chat_rate: stats.sessions > 0 ? stats.chatted / stats.sessions : null,
      revealed: stats.revealed,
      reveal_rate: stats.chatted > 0 ? stats.revealed / stats.chatted : null,
      clicked: stats.clicked,
      converted: stats.converted,
    }))
    .sort((a, b) => b.sessions - a.sessions);

  return { data: geoData, totalSessions: (data ?? []).length };
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
