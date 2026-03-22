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
import { createServiceClient } from '@/lib/supabase/service';
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
    const supabase = createServiceClient();

    // Determine if we have entity-specific filters
    const hasEntityFilter = !!(adId || adsetId || campaignId);

    // Build and execute primary query
    const primaryData = hasEntityFilter
      ? await fetchTrendDataFiltered(supabase as any, {
          metric,
          dateFrom,
          dateTo,
          campaignId,
          adsetId,
          adId,
        })
      : await fetchTrendDataRpc(supabase as any, { metric, dateFrom, dateTo });

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
      const comparisonData = hasEntityFilter
        ? await fetchTrendDataFiltered(supabase as any, {
            metric,
            dateFrom: compareFrom,
            dateTo: compareTo,
            campaignId,
            adsetId,
            adId,
          })
        : await fetchTrendDataRpc(supabase as any, {
            metric,
            dateFrom: compareFrom,
            dateTo: compareTo,
          });

      if (!comparisonData.error) {
        result.comparison = comparisonData.rows;
      }
    }

    return new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'private, s-maxage=900, stale-while-revalidate=1800',
      },
    });
  } catch (err) {
    console.error('Trends API error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Use the aggregate_trends RPC for the common unfiltered case.
 * Aggregation happens server-side in Postgres.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchTrendDataRpc(
  supabase: any,
  opts: { metric: string; dateFrom: string; dateTo: string },
) {
  const { data, error } = await supabase.rpc('aggregate_trends', {
    date_from: opts.dateFrom,
    date_to: opts.dateTo,
    metric_name: opts.metric,
  });

  if (error) {
    return { rows: [], error: error.message };
  }

  const rows: { date: string; value: number | null }[] = (data ?? []).map(
    (row: { report_date: string; metric_value: number | null }) => ({
      date: row.report_date,
      value: row.metric_value !== null ? Number(row.metric_value) : null,
    }),
  );

  return { rows, error: null };
}

/**
 * Fallback for entity-filtered queries (single entity, small data set).
 * Still fetches rows but the result set is small (max ~30 rows for one entity).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchTrendDataFiltered(
  supabase: any,
  opts: {
    metric: string;
    dateFrom: string;
    dateTo: string;
    campaignId: string | null;
    adsetId: string | null;
    adId: string | null;
  },
) {
  const isRateMetric = [
    'chat_rate', 'reveal_rate', 'reveal_click_through_rate',
    'ctr', 'cpc', 'cpm', 'cost_per_chat', 'cost_per_reveal',
    'cost_per_unique_click', 'cost_per_action',
  ].includes(opts.metric);

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

  const { data, error } = await query;

  if (error) {
    return { rows: [], error: error.message };
  }

  // Aggregate by date (handles multiple rows per date at non-ad levels)
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
