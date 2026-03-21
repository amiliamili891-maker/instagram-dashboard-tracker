/**
 * /dashboard/trends — Trends Page
 *
 * Daily metric trends from daily_combined_stats.
 * Supports metric selection, date range via URL params,
 * and comparison mode overlaying two time periods.
 *
 * Auth is handled by the dashboard layout (requireAdminUser).
 */

import { createClient } from '@supabase/supabase-js';
import { getServerEnv } from '@/lib/env';
import { TrendsControls } from './trends-controls';
import { TrendChart } from '@/components/trend-chart';
import { formatMetricValue } from '@/lib/format-utils';

export const dynamic = 'force-dynamic';

/** Cross-source metrics suppressed in degraded/stale states */
const CROSS_SOURCE_METRICS = [
  'cost_per_chat',
  'cost_per_reveal',
  'chat_rate',
  'reveal_rate',
  'reveal_click_through_rate',
];

const RATE_METRICS = [
  'chat_rate', 'reveal_rate', 'reveal_click_through_rate',
  'ctr', 'cpc', 'cpm', 'cost_per_chat', 'cost_per_reveal',
  'cost_per_unique_click', 'cost_per_action',
];

const METRIC_OPTIONS = [
  { value: 'spend', label: 'Spend' },
  { value: 'impressions', label: 'Impressions' },
  { value: 'clicks', label: 'Clicks' },
  { value: 'unique_clicks', label: 'Unique Clicks' },
  { value: 'visits', label: 'Visits' },
  { value: 'chats', label: 'Chats' },
  { value: 'reveals', label: 'Reveals' },
  { value: 'click_throughs', label: 'Click-Throughs' },
  { value: 'chat_rate', label: 'Chat Rate' },
  { value: 'cost_per_chat', label: 'Cost per Chat' },
  { value: 'reveal_rate', label: 'Reveal Rate' },
  { value: 'cost_per_reveal', label: 'Cost per Reveal' },
  { value: 'reveal_click_through_rate', label: 'Reveal Click-Through Rate' },
  { value: 'ctr', label: 'CTR' },
  { value: 'cpc', label: 'CPC' },
  { value: 'cpm', label: 'CPM' },
  { value: 'cost_per_unique_click', label: 'Cost per Unique Click' },
];

function getDefaultDates() {
  const now = new Date();
  const to = now.toISOString().split('T')[0];
  const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  return { from, to };
}

interface TrendRow {
  date: string;
  value: number | null;
}

async function fetchTrends(opts: {
  metric: string;
  dateFrom: string;
  dateTo: string;
  campaignId?: string;
  adsetId?: string;
  adId?: string;
}): Promise<TrendRow[]> {
  const env = getServerEnv();
  const supabase = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const isRate = RATE_METRICS.includes(opts.metric);

  let query = supabase
    .from('daily_combined_stats')
    .select('*')
    .gte('report_date', opts.dateFrom)
    .lte('report_date', opts.dateTo)
    .order('report_date', { ascending: true });

  if (opts.adId) {
    query = query.eq('entity_level', 'ad').eq('entity_id', opts.adId);
  } else if (opts.adsetId) {
    query = query.eq('entity_level', 'adset').eq('entity_id', opts.adsetId);
  } else if (opts.campaignId) {
    query = query.eq('entity_level', 'campaign').eq('entity_id', opts.campaignId);
  }

  const { data } = await query;

  // Aggregate by date
  const byDate = new Map<string, { sum: number; count: number; hasDegradedOrStale: boolean }>();

  for (const row of data ?? []) {
    const date = row.report_date;
    const value = row[opts.metric];
    const freshnessState = row.freshness_state;

    if (!byDate.has(date)) {
      byDate.set(date, { sum: 0, count: 0, hasDegradedOrStale: false });
    }

    const entry = byDate.get(date)!;
    if (freshnessState === 'degraded' || freshnessState === 'stale') {
      entry.hasDegradedOrStale = true;
    }
    if (value !== null && value !== undefined) {
      entry.sum += Number(value);
      entry.count += 1;
    }
  }

  const rows: TrendRow[] = [];
  for (const [date, entry] of byDate) {
    let value: number | null = null;
    const isCrossSource = CROSS_SOURCE_METRICS.includes(opts.metric);

    if (isCrossSource && entry.hasDegradedOrStale) {
      value = null; // Suppressed
    } else if (entry.count > 0) {
      value = isRate ? entry.sum / entry.count : entry.sum;
    }

    rows.push({ date, value });
  }

  return rows;
}

function formatValue(value: number | null, metric: string): string {
  return formatMetricValue(value, metric);
}

export default async function TrendsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedParams = await searchParams;
  const defaults = getDefaultDates();
  const metric = (typeof resolvedParams.metric === 'string' ? resolvedParams.metric : null) ?? 'spend';
  const dateFrom = (typeof resolvedParams.date_from === 'string' ? resolvedParams.date_from : null) ?? defaults.from;
  const dateTo = (typeof resolvedParams.date_to === 'string' ? resolvedParams.date_to : null) ?? defaults.to;
  const campaignId = typeof resolvedParams.campaign_id === 'string' ? resolvedParams.campaign_id : undefined;
  const adsetId = typeof resolvedParams.adset_id === 'string' ? resolvedParams.adset_id : undefined;
  const adId = typeof resolvedParams.ad_id === 'string' ? resolvedParams.ad_id : undefined;
  const compareFrom = typeof resolvedParams.compare_from === 'string' ? resolvedParams.compare_from : undefined;
  const compareTo = typeof resolvedParams.compare_to === 'string' ? resolvedParams.compare_to : undefined;

  const isCrossSource = CROSS_SOURCE_METRICS.includes(metric);
  const metricLabel = METRIC_OPTIONS.find((m) => m.value === metric)?.label ?? metric;

  // Fetch primary data
  const primaryData = await fetchTrends({ metric, dateFrom, dateTo, campaignId, adsetId, adId });

  // Fetch comparison data if requested
  let comparisonData: TrendRow[] | null = null;
  if (compareFrom && compareTo) {
    comparisonData = await fetchTrends({
      metric,
      dateFrom: compareFrom,
      dateTo: compareTo,
      campaignId,
      adsetId,
      adId,
    });
  }

  return (
    <section className="trends-page">
      <header className="trends-header">
        <h1>Trends</h1>
        {isCrossSource && (
          <span className="cross-source-notice">
            Cross-source metric — suppressed when data is degraded or stale
          </span>
        )}
      </header>

      <TrendsControls
        metrics={METRIC_OPTIONS}
        currentMetric={metric}
        dateFrom={dateFrom}
        dateTo={dateTo}
        compareFrom={compareFrom ?? ''}
        compareTo={compareTo ?? ''}
      />

      {primaryData.length === 0 ? (
        <p className="empty-state">No trend data available for this period.</p>
      ) : (
        <>
        <TrendChart
          primaryData={primaryData}
          comparisonData={comparisonData}
          metric={metric}
          metricLabel={metricLabel}
        />

        <div className="trends-table-wrapper">
          <table className="trends-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>{metricLabel}</th>
                {comparisonData && <th>{metricLabel} (comparison)</th>}
              </tr>
            </thead>
            <tbody>
              {primaryData.map((row, i) => (
                <tr key={row.date}>
                  <td>{row.date}</td>
                  <td className={row.value === null ? 'suppressed' : ''}>
                    {formatValue(row.value, metric)}
                  </td>
                  {comparisonData && (
                    <td className={comparisonData[i]?.value === null ? 'suppressed' : ''}>
                      {comparisonData[i] ? formatValue(comparisonData[i].value, metric) : '-'}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </section>
  );
}
