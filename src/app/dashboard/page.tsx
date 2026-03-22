/**
 * /dashboard — Overview Page
 *
 * Freshness banner + KPI top bar + ranked scorecard table +
 * intelligence alerts panel + budget advisor section.
 *
 * Data fetched client-side via API routes to support
 * dynamic period selection via URL search params.
 */

import { Suspense } from "react";
import { KpiBar } from "@/components/kpi-bar";
import { ScorecardTable } from "@/components/scorecard-table";
import { OverviewShell } from "@/components/overview-shell";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  return (
    <section className="overview-page">
      <h1 className="page-title">Overview</h1>

      <OverviewShell>
        <Suspense fallback={<div className="kpi-bar kpi-bar-loading">Loading KPIs...</div>}>
          <KpiBar />
        </Suspense>

        <h2 className="section-title">Active Ads — Ranked by Cost per Chat</h2>

        <Suspense fallback={<div className="scorecard-loading">Loading scorecard...</div>}>
          <ScorecardTable />
        </Suspense>
      </OverviewShell>
    </section>
  );
}
