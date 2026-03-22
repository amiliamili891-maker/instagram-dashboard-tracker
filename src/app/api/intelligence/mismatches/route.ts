/**
 * GET /api/intelligence/mismatches — Creative-funnel mismatch detection
 *
 * Returns detected mismatches where creative performance and funnel metrics
 * diverge (e.g. high click-through but low chat rate).
 *
 * Admin-only.
 */

import { getServerEnv } from '@/lib/env';
import { isAdminEmail } from '@/lib/auth/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
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

    // Build persistence adapter using RPC
    const persistence: MismatchPersistence = {
      async fetchEntitiesForMismatch(): Promise<MismatchEntityInput[]> {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const dateFrom = sevenDaysAgo.toISOString().slice(0, 10);
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
        }>).map((e) => {
          const totalVisits = Number(e.visits);
          const totalChats = Number(e.chats);
          const totalReveals = Number(e.reveals);
          const totalClickThroughs = Number(e.click_throughs);

          const chatRate = totalVisits > 0 ? totalChats / totalVisits : null;
          const revealRate = totalChats > 0 ? totalReveals / totalChats : null;
          const revealClickThroughRate = totalReveals > 0
            ? totalClickThroughs / totalReveals
            : null;

          return {
            entityId: e.entity_id,
            entityLevel: e.entity_level as 'campaign' | 'adset' | 'ad',
            chat_rate: chatRate,
            reveal_rate: revealRate,
            reveal_click_through_rate: revealClickThroughRate,
            visits: totalVisits,
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

    return new Response(JSON.stringify({
      data: result,
      meta: {
        suppressed: false,
      },
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'private, s-maxage=900, stale-while-revalidate=1800',
      },
    });
  } catch (err) {
    console.error('Mismatch detection API error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
