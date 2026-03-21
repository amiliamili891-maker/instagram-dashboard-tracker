/**
 * /dashboard/ads/[id] — Ad Detail Page
 *
 * Shows full metrics for a single ad with link to
 * pre-filtered session diagnostics (placeholder).
 */

import { Suspense } from "react";
import { AdDetail } from "./ad-detail";

export const dynamic = "force-dynamic";

export default async function AdDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <section className="detail-page">
      <Suspense fallback={<div className="table-loading">Loading ad detail...</div>}>
        <AdDetail adId={id} />
      </Suspense>
    </section>
  );
}
