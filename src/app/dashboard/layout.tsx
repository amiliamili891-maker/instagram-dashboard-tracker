import { Suspense } from "react";
import { requireAdminUser } from "@/lib/auth/guards";
import { signOut } from "@/app/dashboard/actions";
import { createServiceClient } from "@/lib/supabase/service";
import { computeFreshness, type SyncLogRow } from "@/lib/sync/freshness";
import { FreshnessBadge } from "@/components/freshness-badge";
import { NavLinks } from "@/components/nav-links";
import { TimeSelector } from "@/components/time-selector";
import { formatTimestamp } from "@/lib/format-utils";

export const dynamic = "force-dynamic";

async function getFreshness() {
  try {
    const supabase = createServiceClient();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: logs } = await supabase
      .from("sync_logs")
      .select("source, status, completed_at, stage")
      .gte("started_at", oneDayAgo)
      .order("started_at", { ascending: false });

    const syncLogs: SyncLogRow[] = (logs ?? []).map((row) => ({
      source: row.source,
      status: row.status,
      completed_at: row.completed_at,
      stage: row.stage,
    }));

    return computeFreshness(syncLogs);
  } catch {
    return null;
  }
}

function formatTs(iso: string | null | undefined): string {
  return formatTimestamp(iso, { fallback: "never" });
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAdminUser();
  const freshness = await getFreshness();

  return (
    <main className="dashboard-shell">
      <a href="#main-content" className="skip-link">Skip to content</a>
      <header className="dashboard-header">
        <div className="header-top">
          <div className="header-left">
            <span className="app-title">Ghstly Analytics</span>
            {freshness && (
              <div className="freshness-info">
                <FreshnessBadge state={freshness.state} />
                <span className="data-as-of">
                  Data: Meta {formatTs(freshness.meta.lastSuccessAt)}
                  {" | "}
                  Ghstly {formatTs(freshness.ghstly.lastSuccessAt)}
                </span>
              </div>
            )}
          </div>
          <div className="header-right">
            <span className="identity-copy">{user.email}</span>
            <form action={signOut}>
              <button className="sign-out-button" type="submit">
                Sign out
              </button>
            </form>
          </div>
        </div>
        <div className="header-controls">
          <NavLinks />
          <TimeSelector />
        </div>
      </header>
      <div id="main-content" className="dashboard-content">{children}</div>
    </main>
  );
}
