/**
 * TierBadge — re-exports from the unified Badge component.
 * Kept as a thin wrapper so existing imports don't break.
 */

"use client";

import { Badge } from "@/components/badge";
import type { TierLabel, TierColor } from "@/lib/intelligence/tier-classifier";

interface TierBadgeProps {
  tier: TierLabel;
  color: TierColor;
  size?: "sm" | "md";
}

export function TierBadge({ tier, color, size = "sm" }: TierBadgeProps) {
  return <Badge variant="tier" tier={tier} color={color} size={size} />;
}
