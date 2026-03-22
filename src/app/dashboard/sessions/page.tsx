/**
 * /dashboard/sessions — Session List Page
 *
 * Paginated table of sessions from the sessions table.
 * Filterable by campaign, adset, ad, date range, and funnel stage.
 *
 * Auth is handled by the dashboard layout (requireAdminUser).
 */

import { createServiceClient } from '@/lib/supabase/service';
import { formatTimestamp } from '@/lib/format-utils';
import { SessionControls } from './session-controls';
import { CsvExportButton } from '@/components/csv-export-button';
import Link from 'next/link';
import { Badge } from '@/components/badge';

export const dynamic = 'force-dynamic';

function getDefaultDates() {
  const now = new Date();
  const to = now.toISOString().split('T')[0];
  const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  return { from, to };
}

function funnelBadges(row: {
  messages_count: number;
  reached_reveal: boolean;
  clicked_through: boolean;
  converted: boolean;
}): string[] {
  const badges: string[] = ['visited'];
  if (row.messages_count > 0) badges.push('chatted');
  if (row.reached_reveal) badges.push('revealed');
  if (row.clicked_through) badges.push('clicked');
  if (row.converted) badges.push('converted');
  return badges;
}

interface SessionRow {
  id: string;
  created_at_utc: string;
  status: string | null;
  messages_count: number;
  brand: string | null;
  reached_reveal: boolean;
  clicked_through: boolean;
  converted: boolean;
  campaign_id: string | null;
  adset_id: string | null;
  ad_id: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  join_status: string;
}

export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedParams = await searchParams;
  const defaults = getDefaultDates();
  const page = Math.max(1, parseInt(typeof resolvedParams.page === 'string' ? resolvedParams.page : '1', 10) || 1);
  const limit = 25;
  const dateFrom = (typeof resolvedParams.date_from === 'string' ? resolvedParams.date_from : null) ?? defaults.from;
  const dateTo = (typeof resolvedParams.date_to === 'string' ? resolvedParams.date_to : null) ?? defaults.to;
  const campaignId = typeof resolvedParams.campaign_id === 'string' ? resolvedParams.campaign_id : undefined;
  const adsetId = typeof resolvedParams.adset_id === 'string' ? resolvedParams.adset_id : undefined;
  const adId = typeof resolvedParams.ad_id === 'string' ? resolvedParams.ad_id : undefined;
  const funnelStage = typeof resolvedParams.funnel_stage === 'string' ? resolvedParams.funnel_stage : undefined;

  // Sorting
  const VALID_SORT_KEYS = ['created_at_utc', 'messages_count', 'city', 'campaign_id', 'adset_id', 'ad_id'] as const;
  type SessionSortKey = typeof VALID_SORT_KEYS[number];
  const rawSortBy = typeof resolvedParams.sort_by === 'string' ? resolvedParams.sort_by : 'created_at_utc';
  const sortBy: SessionSortKey = VALID_SORT_KEYS.includes(rawSortBy as SessionSortKey) ? (rawSortBy as SessionSortKey) : 'created_at_utc';
  const sortDir = resolvedParams.sort_dir === 'asc' ? 'asc' : 'desc';

  const supabase = createServiceClient();

  const offset = (page - 1) * limit;

  let query = supabase
    .from('sessions')
    .select(
      'id, created_at_utc, status, messages_count, brand, reached_reveal, clicked_through, converted, campaign_id, adset_id, ad_id, city, region, country, join_status',
      { count: 'exact' },
    )
    .order(sortBy, { ascending: sortDir === 'asc' })
    .range(offset, offset + limit - 1);

  if (campaignId) query = query.eq('campaign_id', campaignId);
  if (adsetId) query = query.eq('adset_id', adsetId);
  if (adId) query = query.eq('ad_id', adId);
  if (dateFrom) query = query.gte('created_at_utc', `${dateFrom}T00:00:00Z`);
  if (dateTo) query = query.lte('created_at_utc', `${dateTo}T23:59:59Z`);

  if (funnelStage === 'chatted') {
    query = query.gt('messages_count', 0);
  } else if (funnelStage === 'revealed') {
    query = query.eq('reached_reveal', true);
  } else if (funnelStage === 'clicked') {
    query = query.eq('clicked_through', true);
  } else if (funnelStage === 'converted') {
    query = query.eq('converted', true);
  }

  const { data, error, count } = await query;

  const sessions: SessionRow[] = (data ?? []) as SessionRow[];
  const totalCount = count ?? 0;
  const totalPages = Math.ceil(totalCount / limit);

  // Look up ad name if filtering by ad_id
  let adName: string | null = null;
  if (adId) {
    const { data: adEntity } = await supabase
      .from('ads')
      .select('name')
      .eq('id', adId)
      .maybeSingle();
    adName = adEntity?.name ?? null;
  }

  // Build URL with preserved params
  function buildUrl(overrides: Record<string, string | undefined> = {}): string {
    const params = new URLSearchParams();
    const merged = {
      page: String(page),
      date_from: dateFrom,
      date_to: dateTo,
      campaign_id: campaignId,
      adset_id: adsetId,
      ad_id: adId,
      funnel_stage: funnelStage,
      sort_by: sortBy !== 'created_at_utc' ? sortBy : undefined,
      sort_dir: sortDir !== 'desc' ? sortDir : undefined,
      ...overrides,
    };
    for (const [k, v] of Object.entries(merged)) {
      if (v) params.set(k, v);
    }
    return `/dashboard/sessions?${params.toString()}`;
  }

  function pageUrl(p: number): string {
    return buildUrl({ page: String(p) });
  }

  function sortUrl(key: string): string {
    const newDir = key === sortBy ? (sortDir === 'asc' ? 'desc' : 'asc') : 'desc';
    return buildUrl({ sort_by: key, sort_dir: newDir, page: '1' });
  }

  function sortIndicator(key: string): string {
    if (key !== sortBy) return '';
    return sortDir === 'asc' ? ' ▲' : ' ▼';
  }

  return (
    <section className="sessions-page">
      <header className="sessions-header">
        <h1>Sessions</h1>
        <span className="sample-size">
          {totalCount.toLocaleString()} total
        </span>
      </header>

      <div className="controls-row">
        <SessionControls
          dateFrom={dateFrom}
          dateTo={dateTo}
          funnelStage={funnelStage ?? ''}
          campaignId={campaignId ?? ''}
          adsetId={adsetId ?? ''}
          adId={adId ?? ''}
        />
        <CsvExportButton
          rows={sessions.map((s) => ({
            id: s.id,
            created_at_utc: s.created_at_utc,
            status: s.status,
            messages_count: s.messages_count,
            brand: s.brand,
            reached_reveal: s.reached_reveal,
            clicked_through: s.clicked_through,
            converted: s.converted,
            campaign_id: s.campaign_id,
            adset_id: s.adset_id,
            ad_id: s.ad_id,
            city: s.city,
            region: s.region,
            country: s.country,
            funnel: funnelBadges(s).join(', '),
          }))}
          filename={`sessions-${dateFrom}-to-${dateTo}`}
          columns={[
            { key: 'id', label: 'Session ID' },
            { key: 'created_at_utc', label: 'Created' },
            { key: 'campaign_id', label: 'Campaign ID' },
            { key: 'adset_id', label: 'Adset ID' },
            { key: 'ad_id', label: 'Ad ID' },
            { key: 'city', label: 'City' },
            { key: 'region', label: 'Region' },
            { key: 'country', label: 'Country' },
            { key: 'messages_count', label: 'Messages' },
            { key: 'reached_reveal', label: 'Revealed' },
            { key: 'clicked_through', label: 'Clicked' },
            { key: 'converted', label: 'Converted' },
            { key: 'funnel', label: 'Funnel Stage' },
          ]}
        />
      </div>

      {adId && (
        <div className="filter-indicator">
          <span>
            Filtered by ad: <strong>{adName || adId}</strong>
          </span>
          <Link href="/dashboard/sessions" className="clear-filter-link">
            Clear filter
          </Link>
        </div>
      )}

      {error && (
        <div className="error-banner">Failed to load sessions: {error.message}</div>
      )}

      {sessions.length === 0 && !error && (
        <p className="empty-state">No sessions found for this period.</p>
      )}

      {sessions.length > 0 && (
        <>
          <table className="sessions-table">
            <thead>
              <tr>
                <th>Session ID</th>
                <th className="sortable-th">
                  <Link href={sortUrl('created_at_utc')}>Created<span className={`sort-indicator ${sortBy === 'created_at_utc' ? 'active' : ''}`}>{sortIndicator('created_at_utc')}</span></Link>
                </th>
                <th className="sortable-th">
                  <Link href={sortUrl('campaign_id')}>Campaign<span className={`sort-indicator ${sortBy === 'campaign_id' ? 'active' : ''}`}>{sortIndicator('campaign_id')}</span></Link>
                </th>
                <th className="sortable-th">
                  <Link href={sortUrl('adset_id')}>Adset<span className={`sort-indicator ${sortBy === 'adset_id' ? 'active' : ''}`}>{sortIndicator('adset_id')}</span></Link>
                </th>
                <th className="sortable-th">
                  <Link href={sortUrl('ad_id')}>Ad<span className={`sort-indicator ${sortBy === 'ad_id' ? 'active' : ''}`}>{sortIndicator('ad_id')}</span></Link>
                </th>
                <th className="sortable-th">
                  <Link href={sortUrl('city')}>City<span className={`sort-indicator ${sortBy === 'city' ? 'active' : ''}`}>{sortIndicator('city')}</span></Link>
                </th>
                <th>Funnel</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link href={`/dashboard/sessions/${s.id}`} className="session-link">
                      {s.id.slice(0, 8)}...
                    </Link>
                  </td>
                  <td>{formatTimestamp(s.created_at_utc)}</td>
                  <td className="id-cell">{s.campaign_id ? s.campaign_id.slice(0, 12) : '-'}</td>
                  <td className="id-cell">{s.adset_id ? s.adset_id.slice(0, 12) : '-'}</td>
                  <td className="id-cell">{s.ad_id ? s.ad_id.slice(0, 12) : '-'}</td>
                  <td>{s.city || '-'}</td>
                  <td className="funnel-cell">
                    {funnelBadges(s).map((badge) => (
                      <Badge key={badge} variant="funnel" step={badge} />
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {totalPages > 1 && (
            <nav className="pagination">
              {page > 1 && (
                <Link href={pageUrl(page - 1)} className="page-link">
                  Previous
                </Link>
              )}
              <span className="page-info">
                Page {page} of {totalPages}
              </span>
              {page < totalPages && (
                <Link href={pageUrl(page + 1)} className="page-link">
                  Next
                </Link>
              )}
            </nav>
          )}
        </>
      )}
    </section>
  );
}
