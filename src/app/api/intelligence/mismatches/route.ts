/**
 * GET /api/intelligence/mismatches — Creative-funnel mismatch detection
 *
 * Returns detected mismatches where creative performance and funnel metrics
 * diverge (e.g. high click-through but low chat rate).
 *
 * Admin-only.
 */

import { createClient } from '@supabase/supabase-js';
import { getServerEnv } from '@/lib/env';
import { isAdminEmail } from '@/lib/auth/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import {
  detectMismatches,
  type MismatchPersistence,
  type MismatchEntityInput,
} from '@/lib/intelligence/mismatch-detector';
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
          mismatches: [],
          entitiesChecked: 0,
          entitiesFlagged: 0,
        },
        meta: {
          suppressed: true,
          reason: `Data freshness is ${freshnessState} — mismatch detection suppressed`,
        },
      });
    }

    // Build persistence adapter
    const persistence: MismatchPersistence = {
      async fetchEntitiesForMismatch(): Promise<MismatchEntityInput[]> {
        // Get recent combined stats (last 7 days for meaningful aggregation)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const dateFrom = sevenDaysAgo.toISOString().slice(0, 10);
        const dateTo = new Date().toISOString().slice(0, 10);

        const { data, error } = await serviceClient
          .from('daily_combined_stats')
          .select('entity_id, entity_level, visits, chats, reveals, click_throughs')
          .gte('report_date', dateFrom)
          .lte('report_date', dateTo)
          .eq('entity_level', 'ad');

        if (error || !data) return [];

        // Aggregate by entity
        const entityMap = new Map<string, {
          entityId: string;
          entityLevel: 'campaign' | 'adset' | 'ad';
          totalVisits: number;
          totalChats: number;
          totalReveals: number;
          totalClickThroughs: number;
        }>();

        for (const row of data) {
          const key = `${row.entity_id}:${row.entity_level}`;
          const existing = entityMap.get(key);
          if (existing) {
            existing.totalVisits += row.visits ?? 0;
            existing.totalChats += row.chats ?? 0;
            existing.totalReveals += row.reveals ?? 0;
            existing.totalClickThroughs += row.click_throughs ?? 0;
          } else {
            entityMap.set(key, {
              entityId: row.entity_id,
              entityLevel: row.entity_level,
              totalVisits: row.visits ?? 0,
              totalChats: row.chats ?? 0,
              totalReveals: row.reveals ?? 0,
              totalClickThroughs: row.click_throughs ?? 0,
            });
          }
        }

        // Compute aggregated rates from totals
        return Array.from(entityMap.values()).map((e) => {
          const chatRate = e.totalVisits > 0 ? e.totalChats / e.totalVisits : null;
          const revealRate = e.totalChats > 0 ? e.totalReveals / e.totalChats : null;
          const revealClickThroughRate = e.totalReveals > 0
            ? e.totalClickThroughs / e.totalReveals
            : null;

          return {
            entityId: e.entityId,
            entityLevel: e.entityLevel,
            chat_rate: chatRate,
            reveal_rate: revealRate,
            reveal_click_through_rate: revealClickThroughRate,
            visits: e.totalVisits,
          };
        });
      },
    };

    const result = await detectMismatches(persistence);

    // Resolve entity names from ads table
    const entityIds = result.mismatches.map((m) => m.entityId);
    if (entityIds.length > 0) {
      const { data: ads } = await serviceClient
        .from('ads')
        .select('id, name')
        .in('id', entityIds);

      const nameMap = new Map<string, string>();
      for (const ad of ads ?? []) {
        nameMap.set(ad.id, ad.name);
      }

      // Attach names to mismatches
      for (const mismatch of result.mismatches) {
        (mismatch as unknown as Record<string, unknown>).entityName = nameMap.get(mismatch.entityId) ?? null;
      }
    }

    return Response.json({
      data: result,
      meta: {
        suppressed: false,
      },
    });
  } catch (err) {
    console.error('Mismatch detection API error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
