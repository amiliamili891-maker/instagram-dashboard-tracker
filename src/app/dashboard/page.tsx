/**
 * /dashboard — Overview Page
 *
 * KPI top bar + ranked scorecard table.
 * Data fetched client-side via API routes to support
 * dynamic period selection via URL search params.
 */

import { Suspense } from "react";
import { KpiBar } from "@/components/kpi-bar";
import { ScorecardTable } from "@/components/scorecard-table";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  return (
    <section className="overview-page">
      <h1 className="page-title">Overview</h1>

      <Suspense fallback={<div className="kpi-bar kpi-bar-loading">Loading KPIs...</div>}>
        <KpiBar />
      </Suspense>

      <h2 className="section-title">Active Ads — Ranked by Cost per Chat</h2>

      <Suspense fallback={<div className="scorecard-loading">Loading scorecard...</div>}>
        <ScorecardTable />
      </Suspense>
    </section>
  );
}
