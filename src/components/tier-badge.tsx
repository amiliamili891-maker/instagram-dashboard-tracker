"use client";

import type { TierLabel, TierColor } from "@/lib/intelligence/tier-classifier";

interface TierBadgeProps {
  tier: TierLabel;
  color: TierColor;
  /** Show as small inline badge (default) or larger */
  size?: "sm" | "md";
}

/**
 * Reusable tier badge component for drill-down tables.
 * Color-coded by tier classification from the intelligence engine.
 */
export function TierBadge({ tier, color, size = "sm" }: TierBadgeProps) {
  return (
    <span className={`tier-badge tier-${color} tier-badge-${size}`}>
      {tier}
    </span>
  );
}
