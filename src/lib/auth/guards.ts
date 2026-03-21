import { redirect } from "next/navigation";

import { isAdminEmail } from "@/lib/auth/admin";
import { getServerEnv } from "@/lib/env";
import {
  getAuthenticatedUser,
  type DashboardUser,
} from "@/lib/supabase/server";

type UserLoader = () => Promise<DashboardUser | null>;
type RedirectFn = (path: string) => never;

export async function requireAuthenticatedUser(
  loadUser: UserLoader = getAuthenticatedUser,
  redirectTo: RedirectFn = redirect,
) {
  const user = await loadUser();

  if (!user?.email) {
    return redirectTo("/login");
  }

  return user;
}

export async function requireAdminUser(
  loadUser: UserLoader = getAuthenticatedUser,
  adminEmail: string = getServerEnv().adminEmail,
  redirectTo: RedirectFn = redirect,
) {
  const user = await requireAuthenticatedUser(loadUser, redirectTo);

  if (!isAdminEmail(user.email, adminEmail)) {
    return redirectTo(`/login?error=${encodeURIComponent("Access denied")}`);
  }

  return user;
}
