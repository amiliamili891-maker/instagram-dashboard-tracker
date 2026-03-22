/**
 * GET /api/stats/geo
 *
 * Geo breakdown aggregated from sessions table.
 *
 * Query params:
 *   - group_by: 'city' | 'region' | 'country' (required)
 *   - date_from: ISO date string YYYY-MM-DD (required)
 *   - date_to: ISO date string YYYY-MM-DD (required)
 *   - campaign_id: filter (optional)
 *   - adset_id: filter (optional)
 *   - ad_id: filter (optional)
 */

import { type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { requireAdminUser } from '@/lib/auth/guards';

export const dynamic = 'force-dynamic';

const VALID_GROUP_BY = ['city', 'region', 'country'] as const;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest) {
  try {
    await requireAdminUser();
  } catch {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const groupBy = params.get('group_by');
  const dateFrom = params.get('date_from');
  const dateTo = params.get('date_to');
  const campaignId = params.get('campaign_id');
  const adsetId = params.get('adset_id');
  const adId = params.get('ad_id');

  if (!groupBy || !VALID_GROUP_BY.includes(groupBy as typeof VALID_GROUP_BY[number])) {
    return Response.json(
      { error: 'Invalid or missing "group_by" param. Must be city, region, or country.' },
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

  try {
    const supabase = createServiceClient();
    const hasEntityFilter = !!(campaignId || adsetId || adId);

    if (hasEntityFilter) {
      // Entity-filtered: use row-level fetch (small data set for one entity)
      return await handleFilteredGeo(supabase, {
        groupBy, dateFrom, dateTo, campaignId, adsetId, adId,
      });
    }

    // Unfiltered: use RPC for server-side aggregation
    const { data, error } = await supabase.rpc('aggregate_geo', {
      date_from: dateFrom,
      date_to: dateTo,
      group_by_field: groupBy,
    });

    if (error) {
      console.error('Failed to fetch geo data via RPC:', error.message);
      return Response.json({ error: 'Failed to fetch geo data' }, { status: 500 });
    }

    const rpcRows = (data ?? []) as Array<{
      group_name: string;
      sessions: number;
      chatted: number;
      revealed: number;
      clicked: number;
      converted: number;
    }>;

    const totalSessions = rpcRows.reduce((sum, r) => sum + Number(r.sessions), 0);

    const geoData = rpcRows.map((row) => {
      const sessions = Number(row.sessions);
      const chatted = Number(row.chatted);
      return {
        location: row.group_name,
        sessions,
        chatted,
        chat_rate: sessions > 0 ? chatted / sessions : null,
        revealed: Number(row.revealed),
        reveal_rate: chatted > 0 ? Number(row.revealed) / chatted : null,
        clicked: Number(row.clicked),
        converted: Number(row.converted),
      };
    });

    return new Response(JSON.stringify({
      data: geoData,
      meta: {
        group_by: groupBy,
        date_from: dateFrom,
        date_to: dateTo,
        total_sessions: totalSessions,
        unique_locations: geoData.length,
      },
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'private, s-maxage=900, stale-while-revalidate=1800',
      },
    });
  } catch (err) {
    console.error('Geo API error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Fallback for entity-filtered geo queries.
 * Fetches rows with entity filter and aggregates client-side.
 */
async function handleFilteredGeo(
  supabase: ReturnType<typeof createServiceClient>,
  opts: {
    groupBy: string;
    dateFrom: string;
    dateTo: string;
    campaignId: string | null;
    adsetId: string | null;
    adId: string | null;
  },
) {
  let query = supabase
    .from('sessions')
    .select('city, region, country, reached_reveal, clicked_through, converted, messages_count')
    .gte('created_at_utc', `${opts.dateFrom}T00:00:00Z`)
    .lte('created_at_utc', `${opts.dateTo}T23:59:59Z`);

  if (opts.campaignId) {
    query = query.eq('campaign_id', opts.campaignId);
  }
  if (opts.adsetId) {
    query = query.eq('adset_id', opts.adsetId);
  }
  if (opts.adId) {
    query = query.eq('ad_id', opts.adId);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Failed to fetch filtered geo data:', error.message);
    return Response.json({ error: 'Failed to fetch geo data' }, { status: 500 });
  }

  // Aggregate by group_by field
  const groups = new Map<string, {
    sessions: number;
    chatted: number;
    revealed: number;
    clicked: number;
    converted: number;
  }>();

  for (const rawRow of data ?? []) {
    const row = rawRow as unknown as Record<string, unknown>;
    const key = (row[opts.groupBy] as string) || '(unknown)';

    if (!groups.has(key)) {
      groups.set(key, { sessions: 0, chatted: 0, revealed: 0, clicked: 0, converted: 0 });
    }

    const entry = groups.get(key)!;
    entry.sessions += 1;
    if ((row.messages_count as number) > 0) entry.chatted += 1;
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

  return new Response(JSON.stringify({
    data: geoData,
    meta: {
      group_by: opts.groupBy,
      date_from: opts.dateFrom,
      date_to: opts.dateTo,
      total_sessions: (data ?? []).length,
      unique_locations: geoData.length,
    },
  }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, s-maxage=900, stale-while-revalidate=1800',
    },
  });
}
