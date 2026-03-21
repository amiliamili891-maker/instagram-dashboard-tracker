import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getServerEnv } from "@/lib/env";

export type DashboardUser = {
  email: string | null;
};

export async function createServerSupabaseClient() {
  const cookieStore = await cookies();
  const env = getServerEnv();

  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const cookie of cookiesToSet) {
            cookieStore.set(cookie.name, cookie.value, cookie.options);
          }
        } catch {
          // Server components can be read-only. Auth-changing calls should happen in actions/routes.
        }
      },
    },
  });
}

export async function getAuthenticatedUser(): Promise<DashboardUser | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return null;
  }

  return {
    email: data.user.email ?? null,
  };
}
