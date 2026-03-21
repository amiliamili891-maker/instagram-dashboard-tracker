/**
 * POST /api/sessions/[id]/messages/refresh
 *
 * Force re-fetch transcript from Ghstly API.
 * Deletes existing cached messages and re-fetches.
 */

import { type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { requireAdminUser } from '@/lib/auth/guards';
import { fetchAndStoreMessages } from '@/lib/sync/transcript-sync';
import { GhstlyClient, GhstlyApiError } from '@/lib/api/ghstly-client';

export const dynamic = 'force-dynamic';

export async function POST(
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

  // Delete existing cached messages
  await supabase
    .from('session_messages')
    .delete()
    .eq('session_id', id);

  // Re-fetch from Ghstly API
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
