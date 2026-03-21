/**
 * GET /api/intelligence/alerts — Active intelligence alerts
 *
 * Returns alerts from intelligence_alerts table, including:
 * - Threshold alerts (tier classifications)
 * - Data quality alerts (reconciliation breaches)
 * - Anomaly alerts
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
  const alertType = searchParams.get('type'); // 'threshold' | 'data_quality' | 'anomaly'
  const severity = searchParams.get('severity'); // 'warning' | 'critical'
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '100', 10), 500);

  try {
    const serviceClient = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let query = serviceClient
      .from('intelligence_alerts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (alertType) {
      query = query.eq('alert_type', alertType);
    }

    if (severity) {
      query = query.eq('severity', severity);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Failed to fetch intelligence alerts:', error.message);
      return Response.json(
        { error: 'Failed to fetch intelligence alerts' },
        { status: 500 },
      );
    }

    return Response.json({
      data: data ?? [],
      meta: {
        count: data?.length ?? 0,
        filters: { type: alertType, severity },
      },
    });
  } catch (err) {
    console.error('Intelligence alerts API error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
