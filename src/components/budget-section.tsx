"use client";

import { useEffect, useState } from "react";
import type { FreshnessState } from "@/lib/sync/freshness";
import type { BudgetRecommendation } from "@/lib/intelligence/budget-advisor";
import { ImageLightbox } from "@/components/image-lightbox";

type RecWithName = BudgetRecommendation & { entityName?: string | null };

interface BudgetApiResponse {
  data: {
    recommendations: RecWithName[];
    pauseCandidates: RecWithName[];
    scaleCandidates: RecWithName[];
    totalCurrentSpend: number;
    suggestedReallocation: number;
  };
  meta: {
    suppressed: boolean;
    reason?: string;
  };
}

function ActionBadge({ action }: { action: string }) {
  const cls =
    action === "pause"
      ? "budget-action-pause"
      : action === "reduce"
        ? "budget-action-reduce"
        : action === "scale"
          ? "budget-action-scale"
          : "budget-action-maintain";
  return (
    <span className={`budget-action-badge ${cls}`}>
      {action.toUpperCase()}
    </span>
  );
}

function TierBadge({ tier }: { tier: BudgetRecommendation["tier"] }) {
  return (
    <span className={`tier-badge tier-${tier.compositeColor}`}>
      {tier.compositeTier}
    </span>
  );
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
          line.startsWith("→") ? "rationale-advice" :
          line.startsWith("⚠") ? "rationale-warning" :
          line.startsWith("✓") ? "rationale-good" :
          line.startsWith("•") ? "rationale-neutral" :
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
}: {
  freshnessState: FreshnessState | null;
}) {
  const [data, setData] = useState<BudgetApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Suppress client-side when freshness is known to be bad
  const suppressed =
    freshnessState === "degraded" || freshnessState === "stale";

  useEffect(() => {
    if (suppressed) {
      setLoading(false);
      return;
    }

    fetch("/api/intelligence/budget")
      .then((r) => {
        if (!r.ok) throw new Error("Failed");
        return r.json();
      })
      .then((json: BudgetApiResponse) => {
        setData(json);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, [suppressed]);

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

  if (loading) {
    return (
      <div className="budget-section">
        <h2 className="section-title">Budget Advisor</h2>
        <div className="budget-loading">Loading recommendations...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="budget-section">
        <h2 className="section-title">Budget Advisor</h2>
        <div className="budget-empty">Unable to load budget recommendations.</div>
      </div>
    );
  }

  // Also handle server-side suppression
  if (data.meta.suppressed) {
    return (
      <div className="budget-section">
        <h2 className="section-title">Budget Advisor</h2>
        <div className="budget-suppressed">{data.meta.reason}</div>
      </div>
    );
  }

  const { pauseCandidates, scaleCandidates, suggestedReallocation } = data.data;

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
                      <TierBadge tier={rec.tier} />
                    </td>
                    <td>
                      <ActionBadge action={rec.action} />
                    </td>
                    <td>
                      {rec.suggestedSpend !== null
                        ? formatSpend(rec.suggestedSpend)
                        : "—"}
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
                      <TierBadge tier={rec.tier} />
                    </td>
                    <td>
                      <ActionBadge action={rec.action} />
                    </td>
                    <td>
                      {rec.suggestedSpend !== null
                        ? formatSpend(rec.suggestedSpend)
                        : "—"}
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
