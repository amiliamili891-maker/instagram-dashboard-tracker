"use client";

import { useEffect, useState } from "react";
import type { FreshnessState, FreshnessResult } from "@/lib/sync/freshness";

interface SyncStatusResponse {
  freshness: FreshnessResult;
  isRunning: boolean;
  runningSyncId: string | null;
}

export function FreshnessBanner({
  onFreshnessChange,
}: {
  onFreshnessChange?: (state: FreshnessState) => void;
}) {
  const [data, setData] = useState<SyncStatusResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/sync/status")
      .then((r) => r.json())
      .then((json: SyncStatusResponse) => {
        setData(json);
        onFreshnessChange?.(json.freshness.state);
      })
      .catch(() => setError(true));
  }, [onFreshnessChange]);

  if (error) {
    return (
      <div className="freshness-banner freshness-banner-error">
        Unable to fetch sync status.
      </div>
    );
  }

  if (!data) {
    return (
      <div className="freshness-banner freshness-banner-loading">
        Checking data freshness...
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
