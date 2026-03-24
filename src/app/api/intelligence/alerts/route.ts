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
import { getServerEnv } from '@/lib/env';
import { isAdminEmail } from '@/lib/auth/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

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
    const serviceClient = createServiceClient();

    let query = serviceClient
      .from('intelligence_alerts')
      .select('id, entity_id, entity_type, alert_type, severity, title, message, metadata, created_at, dismissed_at')
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

    // Resolve entity names
    const rows = data ?? [];
    const entityIds = [...new Set(rows.map((r: Record<string, unknown>) => r.entity_id as string))];
    const nameMap: Record<string, string> = {};

    if (entityIds.length > 0) {
      // Fetch ads, campaigns, and adsets in parallel
      const [adsResult, campaignsResult, adsetsResult] = await Promise.all([
        serviceClient.from('ads').select('id, name').in('id', entityIds),
        serviceClient.from('campaigns').select('id, name').in('id', entityIds),
        serviceClient.from('adsets').select('id, name').in('id', entityIds),
      ]);

      for (const ad of adsResult.data ?? []) {
        nameMap[ad.id] = ad.name;
      }
      for (const c of campaignsResult.data ?? []) {
        if (!nameMap[c.id]) nameMap[c.id] = c.name;
      }
      for (const a of adsetsResult.data ?? []) {
        if (!nameMap[a.id]) nameMap[a.id] = a.name;
      }

      // Attach names to rows
      for (const row of rows) {
        (row as Record<string, unknown>).entity_name =
          nameMap[(row as Record<string, unknown>).entity_id as string] ?? null;
      }
    }

    return new Response(JSON.stringify({
      data: rows,
      meta: {
        count: rows.length,
        filters: { type: alertType, severity },
      },
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'private, s-maxage=900, stale-while-revalidate=1800',
      },
    });
  } catch (err) {
    console.error('Intelligence alerts API error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
