/**
 * FreshnessBadge — re-exports from the unified Badge component.
 * Kept as a thin wrapper so existing imports (e.g. dashboard layout) don't break.
 */

import { Badge } from "@/components/badge";

export function FreshnessBadge({ state }: { state: string }) {
  return <Badge variant="freshness" state={state} />;
}
