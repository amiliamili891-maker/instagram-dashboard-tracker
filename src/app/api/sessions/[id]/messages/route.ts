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

  // Validate session ID format to prevent path traversal against upstream Ghstly API
  // Session IDs are UUIDs or alphanumeric strings — reject anything with slashes, dots, etc.
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
    return Response.json({ error: 'Invalid session ID format' }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Check cache first
  const { data: cached, error: cacheError } = await supabase
    .from('session_messages')
    .select('id, session_id, message_index, sender_role, message_text, created_at')
    .eq('session_id', id)
    .order('message_index', { ascending: true });

  if (!cacheError && cached && cached.length > 0) {
    return new Response(JSON.stringify({
      data: {
        session_id: id,
        messages: cached,
        cached: true,
        message_count: cached.length,
      },
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'private, s-maxage=900, stale-while-revalidate=1800',
      },
    });
  }

  // Cache miss — fetch from Ghstly API
  try {
    const ghstlyClient = GhstlyClient.fromEnv();
    const messages = await fetchAndStoreMessages(supabase, ghstlyClient, id);

    return new Response(JSON.stringify({
      data: {
        session_id: id,
        messages,
        cached: false,
        message_count: messages.length,
      },
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'private, s-maxage=900, stale-while-revalidate=1800',
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
