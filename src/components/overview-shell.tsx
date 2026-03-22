"use client";

import { useCallback, useState } from "react";
import type { FreshnessState } from "@/lib/sync/freshness";
import { FreshnessBanner } from "@/components/freshness-banner";
import { OverviewAlerts } from "@/components/overview-alerts";
import { BudgetSection } from "@/components/budget-section";

/**
 * Client wrapper that holds freshness state and renders the
 * freshness banner (above children) and the alerts + budget
 * sections (below children). Server-rendered children (KpiBar,
 * ScorecardTable wrapped in Suspense) are passed through.
 */
export function OverviewShell({ children }: { children: React.ReactNode }) {
  const [freshness, setFreshness] = useState<FreshnessState | null>(null);

  const handleFreshnessChange = useCallback((state: FreshnessState) => {
    setFreshness(state);
  }, []);

  return (
    <>
      <FreshnessBanner onFreshnessChange={handleFreshnessChange} />

      {children}

      <OverviewAlerts />

      <BudgetSection freshnessState={freshness} />
    </>
  );
}
