/**
 * GET /api/stats/trends
 *
 * Returns daily time series from daily_combined_stats for charting.
 *
 * Query params:
 *   - metric: column name from daily_combined_stats (required)
 *   - date_from: ISO date string YYYY-MM-DD (required)
 *   - date_to: ISO date string YYYY-MM-DD (required)
 *   - campaign_id: filter (optional)
 *   - adset_id: filter (optional)
 *   - ad_id: filter (optional)
 *   - compare_from: ISO date for comparison period start (optional)
 *   - compare_to: ISO date for comparison period end (optional)
 */

import { type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerEnv } from '@/lib/env';
import { requireAdminUser } from '@/lib/auth/guards';

export const dynamic = 'force-dynamic';

/** Metrics that are valid for trending from daily_combined_stats */
const VALID_METRICS = [
  'spend',
  'impressions',
  'clicks',
  'unique_clicks',
  'cpc',
  'cpm',
  'ctr',
  'visits',
  'chats',
  'reveals',
  'click_throughs',
  'ghstly_conversions',
  'meta_conversions',
  'chat_rate',
  'cost_per_chat',
  'reveal_rate',
  'cost_per_reveal',
  'reveal_click_through_rate',
  'cost_per_unique_click',
  'cost_per_action',
] as const;

/** Cross-source metrics that should be suppressed in degraded/stale states */
const CROSS_SOURCE_METRICS = [
  'cost_per_chat',
  'cost_per_reveal',
  'chat_rate',
  'reveal_rate',
  'reveal_click_through_rate',
];

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest) {
  try {
    await requireAdminUser();
  } catch {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const metric = params.get('metric');
  const dateFrom = params.get('date_from');
  const dateTo = params.get('date_to');
  const campaignId = params.get('campaign_id');
  const adsetId = params.get('adset_id');
  const adId = params.get('ad_id');
  const compareFrom = params.get('compare_from');
  const compareTo = params.get('compare_to');

  // Validate required params
  if (!metric || !VALID_METRICS.includes(metric as typeof VALID_METRICS[number])) {
    return Response.json(
      { error: `Invalid or missing "metric" param. Must be one of: ${VALID_METRICS.join(', ')}` },
      { status: 400 },
    );
  }

  if (!dateFrom || !dateTo) {
    return Response.json(
      { error: 'Missing required "date_from" and "date_to" params.' },
      { status: 400 },
    );
  }

  if (!DATE_REGEX.test(dateFrom) || !DATE_REGEX.test(dateTo)) {
    return Response.json(
      { error: 'Invalid date format. Use YYYY-MM-DD.' },
      { status: 400 },
    );
  }

  if (compareFrom && !DATE_REGEX.test(compareFrom)) {
    return Response.json(
      { error: 'Invalid compare_from date format. Use YYYY-MM-DD.' },
      { status: 400 },
    );
  }

  if (compareTo && !DATE_REGEX.test(compareTo)) {
    return Response.json(
      { error: 'Invalid compare_to date format. Use YYYY-MM-DD.' },
      { status: 400 },
    );
  }

  try {
    const env = getServerEnv();
    const supabase = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Determine entity level from filters
    const entityLevel = adId ? 'ad' : adsetId ? 'adset' : campaignId ? 'campaign' : 'ad';

    // Build and execute primary query
    const primaryData = await fetchTrendData(supabase as any, {
      metric,
      dateFrom,
      dateTo,
      entityLevel,
      campaignId,
      adsetId,
      adId,
    });

    if (primaryData.error) {
      console.error('Failed to fetch trends:', primaryData.error);
      return Response.json({ error: 'Failed to fetch trend data' }, { status: 500 });
    }

    // Build response
    const result: {
      data: { date: string; value: number | null }[];
      comparison?: { date: string; value: number | null }[];
      meta: {
        metric: string;
        date_from: string;
        date_to: string;
        is_cross_source: boolean;
        count: number;
      };
    } = {
      data: primaryData.rows,
      meta: {
        metric,
        date_from: dateFrom,
        date_to: dateTo,
        is_cross_source: CROSS_SOURCE_METRICS.includes(metric),
        count: primaryData.rows.length,
      },
    };

    // Fetch comparison data if requested
    if (compareFrom && compareTo) {
      const comparisonData = await fetchTrendData(supabase as any, {
        metric,
        dateFrom: compareFrom,
        dateTo: compareTo,
        entityLevel,
        campaignId,
        adsetId,
        adId,
      });

      if (!comparisonData.error) {
        result.comparison = comparisonData.rows;
      }
    }

    return Response.json(result);
  } catch (err) {
    console.error('Trends API error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchTrendData(
  supabase: any,
  opts: {
    metric: string;
    dateFrom: string;
    dateTo: string;
    entityLevel: string;
    campaignId: string | null;
    adsetId: string | null;
    adId: string | null;
  },
) {
  // We select report_date and the metric column, grouped by date.
  // Since daily_combined_stats may have multiple entity rows per date,
  // we aggregate: SUM for additive metrics, AVG for rates.
  const isRateMetric = [
    'chat_rate', 'reveal_rate', 'reveal_click_through_rate',
    'ctr', 'cpc', 'cpm', 'cost_per_chat', 'cost_per_reveal',
    'cost_per_unique_click', 'cost_per_action',
  ].includes(opts.metric);

  // Build a raw SQL query via RPC or use select + client-side aggregation
  // Since Supabase JS doesn't support GROUP BY, we fetch raw rows and aggregate client-side
  let query = supabase
    .from('daily_combined_stats')
    .select(`report_date, ${opts.metric}, freshness_state`)
    .gte('report_date', opts.dateFrom)
    .lte('report_date', opts.dateTo)
    .order('report_date', { ascending: true });

  // Apply entity filters
  if (opts.adId) {
    query = query.eq('entity_level', 'ad').eq('entity_id', opts.adId);
  } else if (opts.adsetId) {
    query = query.eq('entity_level', 'adset').eq('entity_id', opts.adsetId);
  } else if (opts.campaignId) {
    query = query.eq('entity_level', 'campaign').eq('entity_id', opts.campaignId);
  }
  // If no entity filter, return all ad-level rows aggregated by date

  const { data, error } = await query;

  if (error) {
    return { rows: [], error: error.message };
  }

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

  const rows: { date: string; value: number | null }[] = [];

  for (const [date, entry] of byDate) {
    let value: number | null = null;

    // Suppress cross-source metrics in degraded/stale state
    const isCrossSource = [
      'cost_per_chat', 'cost_per_reveal', 'chat_rate',
      'reveal_rate', 'reveal_click_through_rate',
    ].includes(opts.metric);

    if (isCrossSource && entry.hasDegradedOrStale) {
      value = null;
    } else if (entry.count > 0) {
      value = isRateMetric ? entry.sum / entry.count : entry.sum;
    }

    rows.push({ date, value });
  }

  return { rows, error: null };
}
