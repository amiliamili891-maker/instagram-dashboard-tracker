/**
 * Supabase service-role client for server-side queries.
 * Uses the service role key — never expose to the client.
 */

import { createClient } from '@supabase/supabase-js';
import { getServerEnv } from '@/lib/env';

export function createServiceClient() {
  const env = getServerEnv();
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
