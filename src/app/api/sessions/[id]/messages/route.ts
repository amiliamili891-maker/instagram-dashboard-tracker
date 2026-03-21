/**
 * GET /api/sessions/[id]/messages
 *
 * Cache-first transcript fetch: checks session_messages first,
 * falls back to Ghstly API on cache miss.
 */

import { type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { requireAdminUser } from '@/lib/auth/guards';
import { fetchAndStoreMessages } from '@/lib/sync/transcript-sync';
import { GhstlyClient, GhstlyApiError } from '@/lib/api/ghstly-client';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdminUser();
  } catch {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const supabase = createServiceClient();

  // Check cache first
  const { data: cached, error: cacheError } = await supabase
    .from('session_messages')
    .select('id, session_id, message_index, sender_role, message_text, created_at')
    .eq('session_id', id)
    .order('message_index', { ascending: true });

  if (!cacheError && cached && cached.length > 0) {
    return Response.json({
      data: {
        session_id: id,
        messages: cached,
        cached: true,
        message_count: cached.length,
      },
    });
  }

  // Cache miss — fetch from Ghstly API
  try {
    const ghstlyClient = GhstlyClient.fromEnv();
    const messages = await fetchAndStoreMessages(supabase, ghstlyClient, id);

    return Response.json({
      data: {
        session_id: id,
        messages,
        cached: false,
        message_count: messages.length,
      },
    });
  } catch (err) {
    if (err instanceof GhstlyApiError && err.isRetryable) {
      return Response.json(
        { error: 'Ghstly API temporarily unavailable. Try again later.' },
        { status: 502 },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
