/**
 * /dashboard/adsets/[id] — Adset Detail Page
 *
 * Shows ads within a specific adset.
 * Click an ad to navigate to its detail page.
 */

import { Suspense } from "react";
import { AdsetDetail } from "./adset-detail";

export const dynamic = "force-dynamic";

export default async function AdsetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <section className="detail-page">
      <Suspense fallback={<div className="table-loading">Loading adset detail...</div>}>
        <AdsetDetail adsetId={id} />
      </Suspense>
    </section>
  );
}
