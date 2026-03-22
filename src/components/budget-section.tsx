"use client";

import type { FreshnessState } from "@/lib/sync/freshness";
import type { BudgetRecommendation } from "@/lib/intelligence/budget-advisor";
import { ImageLightbox } from "@/components/image-lightbox";
import { Badge } from "@/components/badge";
import type { TierLabel, TierColor } from "@/lib/intelligence/tier-classifier";

type RecWithName = BudgetRecommendation & { entityName?: string | null };

export interface BudgetApiData {
  recommendations: RecWithName[];
  pauseCandidates: RecWithName[];
  scaleCandidates: RecWithName[];
  totalCurrentSpend: number;
  suggestedReallocation: number;
}

export interface BudgetApiMeta {
  suppressed: boolean;
  reason?: string;
}

function formatSpend(value: number): string {
  return `$${value.toFixed(2)}`;
}

function RationaleBlock({ rationale }: { rationale: string }) {
  const lines = rationale.split("\n");
  return (
    <div className="rationale-block">
      {lines.map((line, i) => (
        <div key={i} className={
          line.startsWith("\u2192") ? "rationale-advice" :
          line.startsWith("\u26A0") ? "rationale-warning" :
          line.startsWith("\u2713") ? "rationale-good" :
          line.startsWith("\u2022") ? "rationale-neutral" :
          i === 0 ? "rationale-verdict" : "rationale-line"
        }>
          {line}
        </div>
      ))}
    </div>
  );
}

export function BudgetSection({
  freshnessState,
  data,
  meta,
}: {
  freshnessState: FreshnessState | null;
  data: BudgetApiData | null;
  meta: BudgetApiMeta | null;
}) {
  // Suppress when freshness is known to be bad
  const suppressed =
    freshnessState === "degraded" || freshnessState === "stale";

  if (suppressed) {
    return (
      <div className="budget-section">
        <h2 className="section-title">Budget Advisor</h2>
        <div className="budget-suppressed">
          Budget recommendations are suppressed while data freshness is{" "}
          {freshnessState}.
        </div>
      </div>
    );
  }

  if (!data || !meta) {
    return (
      <div className="budget-section">
        <h2 className="section-title">Budget Advisor</h2>
        <div className="budget-empty">Unable to load budget recommendations.</div>
      </div>
    );
  }

  // Also handle server-side suppression
  if (meta.suppressed) {
    return (
      <div className="budget-section">
        <h2 className="section-title">Budget Advisor</h2>
        <div className="budget-suppressed">{meta.reason}</div>
      </div>
    );
  }

  const { pauseCandidates, scaleCandidates, suggestedReallocation } = data;

  if (pauseCandidates.length === 0 && scaleCandidates.length === 0) {
    return (
      <div className="budget-section">
        <h2 className="section-title">Budget Advisor</h2>
        <div className="budget-empty">
          No budget recommendations — all ads are performing within acceptable
          ranges.
        </div>
      </div>
    );
  }

  return (
    <div className="budget-section">
      <div className="budget-header">
        <h2 className="section-title" style={{ margin: 0 }}>
          Budget Advisor
        </h2>
        {suggestedReallocation > 0 && (
          <span className="budget-reallocation">
            Potential savings: {formatSpend(suggestedReallocation)}/day
          </span>
        )}
      </div>

      {pauseCandidates.length > 0 && (
        <div className="budget-list-section">
          <h3 className="budget-list-title budget-list-kill">Kill List</h3>
          <div className="budget-table-wrapper">
            <table className="budget-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Ad</th>
                  <th>Spend</th>
                  <th>Tier</th>
                  <th>Action</th>
                  <th>Suggested</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {pauseCandidates.map((rec) => (
                  <tr key={rec.entityId}>
                    <td className="thumbnail-cell">
                      <ImageLightbox adId={rec.entityId} size="md" />
                    </td>
                    <td className="ad-name-cell" title={rec.entityId}>
                      {rec.entityName || rec.entityId.slice(0, 12) + "..."}
                    </td>
                    <td>{formatSpend(rec.currentSpend)}</td>
                    <td>
                      <Badge
                        variant="tier"
                        tier={rec.tier.compositeTier as TierLabel}
                        color={rec.tier.compositeColor as TierColor}
                      />
                    </td>
                    <td>
                      <Badge variant="budget-action" action={rec.action} />
                    </td>
                    <td>
                      {rec.suggestedSpend !== null
                        ? formatSpend(rec.suggestedSpend)
                        : "\u2014"}
                    </td>
                    <td>
                      <RationaleBlock rationale={rec.rationale} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {scaleCandidates.length > 0 && (
        <div className="budget-list-section">
          <h3 className="budget-list-title budget-list-scale">Scale List</h3>
          <div className="budget-table-wrapper">
            <table className="budget-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Ad</th>
                  <th>Spend</th>
                  <th>Tier</th>
                  <th>Action</th>
                  <th>Suggested</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {scaleCandidates.map((rec) => (
                  <tr key={rec.entityId}>
                    <td className="thumbnail-cell">
                      <ImageLightbox adId={rec.entityId} size="md" />
                    </td>
                    <td className="ad-name-cell" title={rec.entityId}>
                      {rec.entityName || rec.entityId.slice(0, 12) + "..."}
                    </td>
                    <td>{formatSpend(rec.currentSpend)}</td>
                    <td>
                      <Badge
                        variant="tier"
                        tier={rec.tier.compositeTier as TierLabel}
                        color={rec.tier.compositeColor as TierColor}
                      />
                    </td>
                    <td>
                      <Badge variant="budget-action" action={rec.action} />
                    </td>
                    <td>
                      {rec.suggestedSpend !== null
                        ? formatSpend(rec.suggestedSpend)
                        : "\u2014"}
                    </td>
                    <td>
                      <RationaleBlock rationale={rec.rationale} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
