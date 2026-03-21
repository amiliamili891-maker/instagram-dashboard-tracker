/**
 * GET /api/intelligence/tiers — Current tier classifications
 *
 * Returns the latest tier classification for each entity from intelligence_alerts
 * with type = 'threshold'. Each result includes the composite tier, driving metric,
 * and full explanation metadata.
 *
 * Admin-only.
 */

import { type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerEnv } from '@/lib/env';
import { isAdminEmail } from '@/lib/auth/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  // Auth check
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user?.email) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const env = getServerEnv();
  if (!isAdminEmail(user.email, env.adminEmail)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const searchParams = request.nextUrl.searchParams;
  const entityLevel = searchParams.get('level'); // 'campaign' | 'adset' | 'ad'
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '100', 10), 500);

  try {
    const serviceClient = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let query = serviceClient
      .from('intelligence_alerts')
      .select('*')
      .eq('alert_type', 'threshold')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (entityLevel && ['campaign', 'adset', 'ad'].includes(entityLevel)) {
      query = query.eq('entity_type', entityLevel);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Failed to fetch tier classifications:', error.message);
      return Response.json(
        { error: 'Failed to fetch tier classifications' },
        { status: 500 },
      );
    }

    // Deduplicate to latest per entity
    const latestByEntity = new Map<string, typeof data[0]>();
    for (const row of data ?? []) {
      const key = `${row.entity_type}:${row.entity_id}`;
      if (!latestByEntity.has(key)) {
        latestByEntity.set(key, row);
      }
    }

    const tiers = Array.from(latestByEntity.values());

    return Response.json({
      data: tiers,
      meta: {
        count: tiers.length,
        filters: { level: entityLevel },
      },
    });
  } catch (err) {
    console.error('Intelligence tiers API error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
