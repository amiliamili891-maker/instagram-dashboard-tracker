import { requireAdminUser } from "@/lib/auth/guards";
import { signOut } from "@/app/dashboard/actions";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAdminUser();

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <span className="identity-copy">{user.email}</span>
        <form action={signOut}>
          <button className="sign-out-button" type="submit">
            Sign out
          </button>
        </form>
      </header>
      {children}
    </main>
  );
}
