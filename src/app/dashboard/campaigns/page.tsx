/**
 * /dashboard/campaigns — Campaign List Page
 *
 * Shows campaign-level aggregated metrics from daily_combined_stats.
 * Click a campaign to navigate to its detail page.
 */

import { Suspense } from "react";
import { CampaignList } from "./campaign-list";

export const dynamic = "force-dynamic";

export default function CampaignsPage() {
  return (
    <section className="campaigns-page">
      <h1 className="page-title">Campaigns</h1>
      <Suspense fallback={<div className="table-loading">Loading campaigns...</div>}>
        <CampaignList />
      </Suspense>
    </section>
  );
}
