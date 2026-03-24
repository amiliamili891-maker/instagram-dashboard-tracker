/**
 * GET /api/stats/combined
 *
 * Returns combined Meta + Ghstly data from daily_combined_stats.
 *
 * Query params:
 *   - level: 'campaign' | 'adset' | 'ad' (required)
 *   - date_from: ISO date string (required)
 *   - date_to: ISO date string (required)
 *   - campaign_id: filter by campaign (optional)
 *   - adset_id: filter by adset (optional)
 *   - ad_id: filter by ad (optional)
 */

import { type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { requireAdminUser } from '@/lib/auth/guards';

export async function GET(request: NextRequest) {
  // Auth check
  try {
    await requireAdminUser();
  } catch {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const level = searchParams.get('level');
  const dateFrom = searchParams.get('date_from');
  const dateTo = searchParams.get('date_to');
  const campaignId = searchParams.get('campaign_id');
  const adsetId = searchParams.get('adset_id');
  const adId = searchParams.get('ad_id');

  // Validate required params
  if (!level || !['campaign', 'adset', 'ad'].includes(level)) {
    return Response.json(
      { error: 'Invalid or missing "level" param. Must be campaign, adset, or ad.' },
      { status: 400 },
    );
  }

  if (!dateFrom || !dateTo) {
    return Response.json(
      { error: 'Missing required "date_from" and "date_to" params.' },
      { status: 400 },
    );
  }

  // Validate date format
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(dateFrom) || !dateRegex.test(dateTo)) {
    return Response.json(
      { error: 'Invalid date format. Use YYYY-MM-DD.' },
      { status: 400 },
    );
  }

  try {
    const supabase = createServiceClient();

    const SELECTED_COLUMNS = 'entity_id, report_date, entity_level, spend, impressions, clicks, unique_clicks, chats, visits, reveals, click_throughs, meta_conversions, ghstly_conversions';

    let query = supabase
      .from('daily_combined_stats')
      .select(SELECTED_COLUMNS)
      .eq('entity_level', level)
      .gte('report_date', dateFrom)
      .lte('report_date', dateTo)
      .order('report_date', { ascending: false });

    // Apply optional entity filters
    // daily_combined_stats only has entity_id (campaign_id at campaign level,
    // adset_id at adset level, ad_id at ad level). For cross-level filtering
    // (e.g. campaign_id filter at ad level), we look up child entity IDs first.
    if (campaignId) {
      if (level === 'campaign') {
        query = query.eq('entity_id', campaignId);
      } else if (level === 'adset') {
        const { data: adsets } = await supabase
          .from('adsets').select('id').eq('campaign_id', campaignId);
        const adsetIds = adsets?.map((a) => a.id) ?? [];
        if (adsetIds.length === 0) {
          return Response.json({ data: [], meta: { level, date_from: dateFrom, date_to: dateTo, count: 0 } });
        }
        query = query.in('entity_id', adsetIds);
      } else if (level === 'ad') {
        const { data: ads } = await supabase
          .from('ads').select('id').eq('campaign_id', campaignId);
        const childAdIds = ads?.map((a) => a.id) ?? [];
        if (childAdIds.length === 0) {
          return Response.json({ data: [], meta: { level, date_from: dateFrom, date_to: dateTo, count: 0 } });
        }
        query = query.in('entity_id', childAdIds);
      }
    }

    if (adsetId) {
      if (level === 'adset') {
        query = query.eq('entity_id', adsetId);
      } else if (level === 'ad') {
        const { data: ads } = await supabase
          .from('ads').select('id').eq('adset_id', adsetId);
        const childAdIds = ads?.map((a) => a.id) ?? [];
        if (childAdIds.length === 0) {
          return Response.json({ data: [], meta: { level, date_from: dateFrom, date_to: dateTo, count: 0 } });
        }
        query = query.in('entity_id', childAdIds);
      }
    }

    if (adId) {
      if (level === 'ad') {
        query = query.eq('entity_id', adId);
      }
    }

    const { data, error } = await query;

    if (error) {
      console.error('Failed to fetch combined stats:', error.message);
      return Response.json(
        { error: 'Failed to fetch combined stats' },
        { status: 500 },
      );
    }

    return new Response(JSON.stringify({
      data: data ?? [],
      meta: {
        level,
        date_from: dateFrom,
        date_to: dateTo,
        count: data?.length ?? 0,
      },
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'private, s-maxage=900, stale-while-revalidate=1800',
      },
    });
  } catch (err) {
    console.error('Combined stats API error:', err);
    return Response.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
