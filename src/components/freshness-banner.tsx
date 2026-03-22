/**
 * Freshness Banner — Server component that displays data freshness status.
 * Data is fetched by the page and passed as props.
 */

import type { FreshnessState, FreshnessResult } from "@/lib/sync/freshness";

export interface FreshnessBannerData {
  freshness: FreshnessResult;
  isRunning: boolean;
}

export function FreshnessBanner({ data }: { data: FreshnessBannerData | null }) {
  if (!data) {
    return (
      <div className="freshness-banner freshness-banner-error">
        Unable to fetch sync status.
      </div>
    );
  }

  const { freshness, isRunning } = data;
  const state = freshness.state;
  const bannerClass =
    state === "fresh"
      ? "freshness-banner-fresh"
      : state === "degraded"
        ? "freshness-banner-degraded"
        : "freshness-banner-stale";

  const badgeClass =
    state === "fresh"
      ? "badge-fresh"
      : state === "degraded"
        ? "badge-degraded"
        : "badge-stale";

  // Find the most recent sync timestamp
  const latestSync =
    freshness.meta.lastSuccessAt ?? freshness.ghstly.lastSuccessAt;
  const dataAsOf = latestSync
    ? new Date(latestSync).toLocaleString("en-US", {
        timeZone: "America/Los_Angeles",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
    : "Unknown";

  return (
    <div className={`freshness-banner ${bannerClass}`}>
      <div className="freshness-banner-content">
        <span className={`freshness-badge ${badgeClass}`}>
          {state.toUpperCase()}
        </span>
        <span className="freshness-banner-text">
          Data as of: {dataAsOf}
          {isRunning && " — Sync in progress..."}
        </span>
      </div>
      {state !== "fresh" && (
        <p className="freshness-banner-warning">
          Data is {state} — some recommendations may be suppressed until the
          next successful sync.
        </p>
      )}
    </div>
  );
}
