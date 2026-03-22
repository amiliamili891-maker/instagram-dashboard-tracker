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
import { CsvExportButton } from '@/components/csv-export-button';
import Link from 'next/link';

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

  // Sorting
  const VALID_GEO_SORT_KEYS = ['location', 'sessions', 'chatted', 'chat_rate', 'revealed', 'reveal_rate', 'clicked', 'converted'] as const;
  type GeoSortKey = typeof VALID_GEO_SORT_KEYS[number];
  const rawSortBy = typeof resolvedParams.sort_by === 'string' ? resolvedParams.sort_by : 'sessions';
  const sortBy: GeoSortKey = VALID_GEO_SORT_KEYS.includes(rawSortBy as GeoSortKey) ? (rawSortBy as GeoSortKey) : 'sessions';
  const sortDir = resolvedParams.sort_dir === 'asc' ? 'asc' : 'desc';

  const { data: geoData, totalSessions } = await fetchGeoData({
    groupBy,
    dateFrom,
    dateTo,
    campaignId,
    adsetId,
    adId,
  });

  // Apply sorting
  const sortedGeoData = [...geoData].sort((a, b) => {
    const aVal = a[sortBy];
    const bVal = b[sortBy];
    if (aVal === null || aVal === undefined) return 1;
    if (bVal === null || bVal === undefined) return -1;
    let cmp: number;
    if (typeof aVal === 'number' && typeof bVal === 'number') {
      cmp = aVal - bVal;
    } else {
      cmp = String(aVal).localeCompare(String(bVal));
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  function geoSortUrl(key: string): string {
    const params = new URLSearchParams();
    params.set('group_by', groupBy);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    if (campaignId) params.set('campaign_id', campaignId);
    if (adsetId) params.set('adset_id', adsetId);
    if (adId) params.set('ad_id', adId);
    const newDir = key === sortBy ? (sortDir === 'asc' ? 'desc' : 'asc') : 'desc';
    params.set('sort_by', key);
    params.set('sort_dir', newDir);
    return `/dashboard/geo?${params.toString()}`;
  }

  function geoSortIndicator(key: string): string {
    if (key !== sortBy) return '';
    return sortDir === 'asc' ? ' ▲' : ' ▼';
  }

  const groupByLabel = groupBy.charAt(0).toUpperCase() + groupBy.slice(1);

  return (
    <section className="geo-page">
      <header className="geo-header">
        <h1>Geo Breakdown</h1>
        <span className="sample-size">
          {totalSessions.toLocaleString()} total sessions
        </span>
      </header>

      <div className="controls-row">
        <GeoControls
          currentGroupBy={groupBy}
          dateFrom={dateFrom}
          dateTo={dateTo}
        />
        <CsvExportButton
          rows={sortedGeoData.map((row) => ({
            location: row.location,
            sessions: row.sessions,
            chatted: row.chatted,
            chat_rate: row.chat_rate !== null ? (row.chat_rate * 100).toFixed(1) + '%' : '',
            revealed: row.revealed,
            reveal_rate: row.reveal_rate !== null ? (row.reveal_rate * 100).toFixed(1) + '%' : '',
            clicked: row.clicked,
            converted: row.converted,
          }))}
          filename={`geo-${groupBy}-${dateFrom}-to-${dateTo}`}
          columns={[
            { key: 'location', label: groupByLabel },
            { key: 'sessions', label: 'Sessions' },
            { key: 'chatted', label: 'Chatted' },
            { key: 'chat_rate', label: 'Chat Rate' },
            { key: 'revealed', label: 'Revealed' },
            { key: 'reveal_rate', label: 'Reveal Rate' },
            { key: 'clicked', label: 'Clicked' },
            { key: 'converted', label: 'Converted' },
          ]}
        />
      </div>

      {geoData.length === 0 ? (
        <p className="empty-state">No geo data available for this period.</p>
      ) : (
        <table className="geo-table">
          <thead>
            <tr>
              <th className="sortable-th">
                <Link href={geoSortUrl('location')}>{groupByLabel}<span className={`sort-indicator ${sortBy === 'location' ? 'active' : ''}`}>{geoSortIndicator('location')}</span></Link>
              </th>
              <th className="sortable-th">
                <Link href={geoSortUrl('sessions')}>Sessions<span className={`sort-indicator ${sortBy === 'sessions' ? 'active' : ''}`}>{geoSortIndicator('sessions')}</span></Link>
              </th>
              <th className="sortable-th">
                <Link href={geoSortUrl('chatted')}>Chatted<span className={`sort-indicator ${sortBy === 'chatted' ? 'active' : ''}`}>{geoSortIndicator('chatted')}</span></Link>
              </th>
              <th className="sortable-th">
                <Link href={geoSortUrl('chat_rate')}>Chat Rate<span className={`sort-indicator ${sortBy === 'chat_rate' ? 'active' : ''}`}>{geoSortIndicator('chat_rate')}</span></Link>
              </th>
              <th className="sortable-th">
                <Link href={geoSortUrl('revealed')}>Revealed<span className={`sort-indicator ${sortBy === 'revealed' ? 'active' : ''}`}>{geoSortIndicator('revealed')}</span></Link>
              </th>
              <th className="sortable-th">
                <Link href={geoSortUrl('reveal_rate')}>Reveal Rate<span className={`sort-indicator ${sortBy === 'reveal_rate' ? 'active' : ''}`}>{geoSortIndicator('reveal_rate')}</span></Link>
              </th>
              <th className="sortable-th">
                <Link href={geoSortUrl('clicked')}>Clicked<span className={`sort-indicator ${sortBy === 'clicked' ? 'active' : ''}`}>{geoSortIndicator('clicked')}</span></Link>
              </th>
              <th className="sortable-th">
                <Link href={geoSortUrl('converted')}>Converted<span className={`sort-indicator ${sortBy === 'converted' ? 'active' : ''}`}>{geoSortIndicator('converted')}</span></Link>
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedGeoData.map((row) => (
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
