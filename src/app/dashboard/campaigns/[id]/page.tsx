/**
 * /dashboard/campaigns/[id] — Campaign Detail Page
 *
 * Shows adsets within a specific campaign.
 * Click an adset to navigate to its detail page.
 */

import { Suspense } from "react";
import { CampaignDetail } from "./campaign-detail";

export const dynamic = "force-dynamic";

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <section className="detail-page">
      <Suspense fallback={<div className="table-loading">Loading campaign detail...</div>}>
        <CampaignDetail campaignId={id} />
      </Suspense>
    </section>
  );
}
