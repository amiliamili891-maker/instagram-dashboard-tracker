/**
 * GET /api/intelligence/budget — Budget recommendations
 *
 * Returns budget reallocation recommendations: pause/reduce candidates
 * and scale candidates, with rationale and suggested amounts.
 *
 * Admin-only.
 */

import { createClient } from '@supabase/supabase-js';
import { getServerEnv } from '@/lib/env';
import { isAdminEmail } from '@/lib/auth/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import {
  generateBudgetRecommendations,
  type BudgetPersistence,
  type BudgetEntityInput,
} from '@/lib/intelligence/budget-advisor';
import { type FreshnessState } from '@/lib/sync/freshness';

export const dynamic = 'force-dynamic';

export async function GET() {
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
    const serviceClient = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

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
        },
        meta: {
          suppressed: true,
          reason: `Data freshness is ${freshnessState} — budget recommendations suppressed`,
        },
      });
    }

    // Build persistence adapter
    const persistence: BudgetPersistence = {
      async fetchEntitiesWithSpend(): Promise<BudgetEntityInput[]> {
        // Get recent combined stats (last 7 days for meaningful aggregation)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const dateFrom = sevenDaysAgo.toISOString().slice(0, 10);
        const dateTo = new Date().toISOString().slice(0, 10);

        const { data, error } = await serviceClient
          .from('daily_combined_stats')
          .select('entity_id, entity_level, spend, visits, chats, reveals, click_throughs, chat_rate, cost_per_chat, reveal_rate, freshness_state')
          .gte('report_date', dateFrom)
          .lte('report_date', dateTo)
          .eq('entity_level', 'ad');

        if (error || !data) return [];

        // Aggregate by entity
        const entityMap = new Map<string, BudgetEntityInput>();
        for (const row of data) {
          const key = `${row.entity_id}:${row.entity_level}`;
          const existing = entityMap.get(key);
          if (existing) {
            existing.spend += row.spend ?? 0;
            existing.visits += row.visits ?? 0;
          } else {
            entityMap.set(key, {
              entityId: row.entity_id,
              entityLevel: row.entity_level,
              spend: row.spend ?? 0,
              visits: row.visits ?? 0,
              chat_rate: row.chat_rate,
              cost_per_chat: row.cost_per_chat,
              reveal_rate: row.reveal_rate,
              freshnessState: row.freshness_state as FreshnessState | null,
            });
          }
        }

        return Array.from(entityMap.values());
      },
    };

    const result = await generateBudgetRecommendations(persistence);

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

    return Response.json({
      data: result,
      meta: {
        suppressed: false,
      },
    });
  } catch (err) {
    console.error('Budget recommendations API error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
