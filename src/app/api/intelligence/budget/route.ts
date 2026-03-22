/**
 * GET /api/intelligence/budget — Budget recommendations
 *
 * Returns budget reallocation recommendations: pause/reduce candidates
 * and scale candidates, with rationale and suggested amounts.
 *
 * Admin-only.
 */

import { getServerEnv } from '@/lib/env';
import { isAdminEmail } from '@/lib/auth/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import {
  generateBudgetRecommendations,
  type BudgetPersistence,
  type BudgetEntityInput,
} from '@/lib/intelligence/budget-advisor';
import { type FreshnessState } from '@/lib/sync/freshness';

export const dynamic = 'force-dynamic';

const ALLOWED_DAYS = [1, 3, 5, 7] as const;

export async function GET(request: Request) {
  // Parse lookback days from query params
  const { searchParams } = new URL(request.url);
  const daysParam = Number(searchParams.get('days'));
  const numDays = ALLOWED_DAYS.includes(daysParam as typeof ALLOWED_DAYS[number]) ? daysParam : 7;

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

  try {
    const serviceClient = createServiceClient();

    // Check freshness — suppress in degraded/stale
    const { data: syncLogs } = await serviceClient
      .from('sync_logs')
      .select('source, status, completed_at')
      .eq('status', 'success')
      .order('completed_at', { ascending: false })
      .limit(10);

    const metaSuccess = syncLogs?.find((l) => l.source === 'meta');
    const ghstlySuccess = syncLogs?.find((l) => l.source === 'ghstly');

    let freshnessState: FreshnessState = 'fresh';
    if (!metaSuccess && !ghstlySuccess) {
      freshnessState = 'stale';
    } else if (!metaSuccess || !ghstlySuccess) {
      freshnessState = 'degraded';
    }

    if (freshnessState === 'stale' || freshnessState === 'degraded') {
      return Response.json({
        data: {
          recommendations: [],
          pauseCandidates: [],
          scaleCandidates: [],
          totalCurrentSpend: 0,
          suggestedReallocation: 0,
          numDays,
        },
        meta: {
          suppressed: true,
          reason: `Data freshness is ${freshnessState} — budget recommendations suppressed`,
          days: numDays,
        },
      });
    }

    // Build persistence adapter using RPC
    const persistence: BudgetPersistence = {
      async fetchEntitiesWithSpend(): Promise<BudgetEntityInput[]> {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - numDays);
        const dateFrom = startDate.toISOString().slice(0, 10);
        const dateTo = new Date().toISOString().slice(0, 10);

        const { data, error } = await serviceClient.rpc('aggregate_entity_funnel', {
          date_from: dateFrom,
          date_to: dateTo,
        });

        if (error || !data) return [];

        return (data as Array<{
          entity_id: string;
          entity_level: string;
          spend: number;
          visits: number;
          chats: number;
          reveals: number;
          click_throughs: number;
        }>).map((row) => {
          const spend = Number(row.spend); // Period total — advisor normalizes internally
          const visits = Number(row.visits);
          const chats = Number(row.chats);
          const reveals = Number(row.reveals);

          return {
            entityId: row.entity_id,
            entityLevel: row.entity_level as 'campaign' | 'adset' | 'ad',
            spend,
            visits,
            chat_rate: visits > 0 ? chats / visits : null,
            cost_per_chat: chats > 0 ? spend / chats : null,
            reveal_rate: chats > 0 ? reveals / chats : null,
            freshnessState: null,
          };
        });
      },
    };

    const result = await generateBudgetRecommendations(persistence, undefined, numDays);

    // Resolve entity names from ads/adsets/campaigns tables
    const entityIds = result.recommendations.map((r) => r.entityId);
    if (entityIds.length > 0) {
      const { data: ads } = await serviceClient
        .from('ads')
        .select('id, name')
        .in('id', entityIds);

      const nameMap = new Map<string, string>();
      for (const ad of ads ?? []) {
        nameMap.set(ad.id, ad.name);
      }

      // Attach names to recommendations
      for (const rec of result.recommendations) {
        (rec as unknown as Record<string, unknown>).entityName = nameMap.get(rec.entityId) ?? null;
      }
      for (const rec of result.pauseCandidates) {
        (rec as unknown as Record<string, unknown>).entityName = nameMap.get(rec.entityId) ?? null;
      }
      for (const rec of result.scaleCandidates) {
        (rec as unknown as Record<string, unknown>).entityName = nameMap.get(rec.entityId) ?? null;
      }
    }

    return new Response(JSON.stringify({
      data: result,
      meta: {
        suppressed: false,
        days: numDays,
      },
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'private, s-maxage=900, stale-while-revalidate=1800',
      },
    });
  } catch (err) {
    console.error('Budget recommendations API error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
