/**
 * FreshnessBadge — displays FRESH / DEGRADED / STALE state.
 * Server component, no client directive needed.
 */

export function FreshnessBadge({ state }: { state: string }) {
  const colors: Record<string, string> = {
    fresh: "badge-fresh",
    degraded: "badge-degraded",
    stale: "badge-stale",
  };

  return (
    <span className={`freshness-badge ${colors[state] ?? "badge-stale"}`}>
      {state.toUpperCase()}
    </span>
  );
}
