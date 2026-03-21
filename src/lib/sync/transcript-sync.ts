/**
 * On-demand transcript fetching and durable storage.
 * Fetches from Ghstly API, maps sender roles, upserts into session_messages.
 */

import type { GhstlyClient } from '@/lib/api/ghstly-client';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface StoredMessage {
  id: string;
  session_id: string;
  message_index: number;
  sender_role: 'user' | 'assistant' | 'system';
  message_text: string;
  created_at: string | null;
  synced_at: string;
}

/**
 * Fetch messages from Ghstly API and store durably in session_messages.
 * Maps Ghstly sender 'bot' → DB sender_role 'assistant'.
 */
export async function fetchAndStoreMessages(
  supabase: SupabaseClient,
  ghstlyClient: GhstlyClient,
  sessionId: string,
): Promise<StoredMessage[]> {
  const response = await ghstlyClient.fetchSessionMessages(sessionId);

  if (!response.items || response.items.length === 0) {
    return [];
  }

  const rows = response.items.map((msg, index) => ({
    session_id: sessionId,
    message_index: index,
    sender_role: msg.sender === 'bot' ? 'assistant' : msg.sender,
    message_text: msg.content,
    created_at: msg.created_at || null,
    raw: msg,
  }));

  const { data, error } = await supabase
    .from('session_messages')
    .upsert(rows, { onConflict: 'session_id,message_index' })
    .select('id, session_id, message_index, sender_role, message_text, created_at, synced_at');

  if (error) {
    throw new Error(`Failed to store messages for session ${sessionId}: ${error.message}`);
  }

  return (data ?? []) as StoredMessage[];
}
