/**
 * GET /api/sessions
 *
 * Paginated session list from sessions table.
 *
 * Query params:
 *   - page: page number, 1-indexed (default: 1)
 *   - limit: items per page, max 100 (default: 25)
 *   - campaign_id: filter (optional)
 *   - adset_id: filter (optional)
 *   - ad_id: filter (optional)
 *   - date_from: ISO date YYYY-MM-DD (optional)
 *   - date_to: ISO date YYYY-MM-DD (optional)
 *   - funnel_stage: 'visited' | 'chatted' | 'revealed' | 'clicked' | 'converted' (optional)
 */

import { type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerEnv } from '@/lib/env';
import { requireAdminUser } from '@/lib/auth/guards';

export const dynamic = 'force-dynamic';

const VALID_FUNNEL_STAGES = ['visited', 'chatted', 'revealed', 'clicked', 'converted'] as const;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest) {
  try {
    await requireAdminUser();
  } catch {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const page = Math.max(1, parseInt(params.get('page') ?? '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(params.get('limit') ?? '25', 10) || 25));
  const campaignId = params.get('campaign_id');
  const adsetId = params.get('adset_id');
  const adId = params.get('ad_id');
  const dateFrom = params.get('date_from');
  const dateTo = params.get('date_to');
  const funnelStage = params.get('funnel_stage');

  // Validate optional date params
  if (dateFrom && !DATE_REGEX.test(dateFrom)) {
    return Response.json({ error: 'Invalid date_from format. Use YYYY-MM-DD.' }, { status: 400 });
  }
  if (dateTo && !DATE_REGEX.test(dateTo)) {
    return Response.json({ error: 'Invalid date_to format. Use YYYY-MM-DD.' }, { status: 400 });
  }
  if (funnelStage && !VALID_FUNNEL_STAGES.includes(funnelStage as typeof VALID_FUNNEL_STAGES[number])) {
    return Response.json(
      { error: `Invalid funnel_stage. Must be one of: ${VALID_FUNNEL_STAGES.join(', ')}` },
      { status: 400 },
    );
  }

  try {
    const env = getServerEnv();
    const supabase = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const offset = (page - 1) * limit;

    // Build query
    let query = supabase
      .from('sessions')
      .select(
        'id, created_at_utc, started_at_utc, ended_at_utc, status, messages_count, brand, reached_reveal, clicked_through, converted, campaign_id, adset_id, ad_id, city, region, country, join_status',
        { count: 'exact' },
      )
      .order('created_at_utc', { ascending: false })
      .range(offset, offset + limit - 1);

    // Apply filters
    if (campaignId) query = query.eq('campaign_id', campaignId);
    if (adsetId) query = query.eq('adset_id', adsetId);
    if (adId) query = query.eq('ad_id', adId);
    if (dateFrom) query = query.gte('created_at_utc', `${dateFrom}T00:00:00Z`);
    if (dateTo) query = query.lte('created_at_utc', `${dateTo}T23:59:59Z`);

    // Apply funnel stage filter
    if (funnelStage === 'chatted') {
      query = query.gt('messages_count', 0);
    } else if (funnelStage === 'revealed') {
      query = query.eq('reached_reveal', true);
    } else if (funnelStage === 'clicked') {
      query = query.eq('clicked_through', true);
    } else if (funnelStage === 'converted') {
      query = query.eq('converted', true);
    }
    // 'visited' means all sessions — no additional filter needed

    const { data, error, count } = await query;

    if (error) {
      console.error('Failed to fetch sessions:', error.message);
      return Response.json({ error: 'Failed to fetch sessions' }, { status: 500 });
    }

    const totalCount = count ?? 0;

    return Response.json({
      data: data ?? [],
      meta: {
        page,
        limit,
        total: totalCount,
        total_pages: Math.ceil(totalCount / limit),
      },
    });
  } catch (err) {
    console.error('Sessions API error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
