/**
 * GET /api/sessions/[id]
 *
 * Returns a single session with full metadata.
 */

import { type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { requireAdminUser } from '@/lib/auth/guards';

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

  if (!id || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
    return Response.json({ error: 'Invalid session ID' }, { status: 400 });
  }

  try {
    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from('sessions')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return Response.json({ error: 'Session not found' }, { status: 404 });
      }
      console.error('Failed to fetch session:', error.message);
      return Response.json({ error: 'Failed to fetch session' }, { status: 500 });
    }

    // Compute duration if both timestamps exist
    let durationMs: number | null = null;
    if (data.started_at_utc && data.ended_at_utc) {
      durationMs = new Date(data.ended_at_utc).getTime() - new Date(data.started_at_utc).getTime();
    }

    // Strip source_payload to avoid leaking raw data (may contain PII hash etc.)
    const { source_payload: _sp, ...sessionData } = data;

    return new Response(JSON.stringify({
      data: {
        ...sessionData,
        duration_ms: durationMs,
      },
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'private, s-maxage=900, stale-while-revalidate=1800',
      },
    });
  } catch (err) {
    console.error('Session detail API error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
