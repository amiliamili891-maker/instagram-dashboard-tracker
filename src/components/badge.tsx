"use client";

import type { TierLabel, TierColor } from "@/lib/intelligence/tier-classifier";

// ---------------------------------------------------------------------------
// Variant Types
// ---------------------------------------------------------------------------

interface TierVariantProps {
  variant: "tier";
  tier: TierLabel;
  color: TierColor;
  size?: "sm" | "md";
}

interface FreshnessVariantProps {
  variant: "freshness";
  state: string;
}

interface SeverityVariantProps {
  variant: "severity";
  severity: string;
}

interface ActionVariantProps {
  variant: "action";
  action: string;
}

interface StatusVariantProps {
  variant: "status";
  status: string;
}

interface FunnelVariantProps {
  variant: "funnel";
  step: string;
}

interface JoinVariantProps {
  variant: "join";
  joinStatus: string;
}

interface MismatchPatternVariantProps {
  variant: "mismatch-pattern";
  pattern: string;
}

interface BudgetActionVariantProps {
  variant: "budget-action";
  action: string;
}

export type BadgeProps =
  | TierVariantProps
  | FreshnessVariantProps
  | SeverityVariantProps
  | ActionVariantProps
  | StatusVariantProps
  | FunnelVariantProps
  | JoinVariantProps
  | MismatchPatternVariantProps
  | BudgetActionVariantProps;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Unified Badge component for all badge variants in the dashboard.
 *
 * Preserves existing CSS class names so styling is not affected.
 */
export function Badge(props: BadgeProps) {
  switch (props.variant) {
    case "tier": {
      const { tier, color, size = "sm" } = props;
      return (
        <span className={`tier-badge tier-${color} tier-badge-${size}`}>
          {tier}
        </span>
      );
    }

    case "freshness": {
      const colors: Record<string, string> = {
        fresh: "badge-fresh",
        degraded: "badge-degraded",
        stale: "badge-stale",
      };
      return (
        <span className={`freshness-badge ${colors[props.state] ?? "badge-stale"}`}>
          {props.state.toUpperCase()}
        </span>
      );
    }

    case "severity": {
      const colors: Record<string, string> = {
        critical: "badge-critical",
        warning: "badge-warning",
        info: "badge-info",
      };
      return (
        <span className={`severity-badge ${colors[props.severity] ?? "badge-info"}`}>
          {props.severity}
        </span>
      );
    }

    case "action": {
      const colors: Record<string, string> = {
        pause: "badge-action-pause",
        reduce: "badge-action-reduce",
        scale: "badge-action-scale",
        increase: "badge-action-scale",
        maintain: "badge-action-maintain",
      };
      return (
        <span className={`action-badge ${colors[props.action] ?? "badge-action-maintain"}`}>
          {props.action}
        </span>
      );
    }

    case "status": {
      return (
        <span className={`status-badge status-${props.status}`}>
          {props.status}
        </span>
      );
    }

    case "funnel": {
      return (
        <span className={`funnel-badge funnel-${props.step}`}>
          {props.step}
        </span>
      );
    }

    case "join": {
      return (
        <span className={`join-badge join-${props.joinStatus}`}>
          {props.joinStatus}
        </span>
      );
    }

    case "mismatch-pattern": {
      const isOrange = props.pattern === "high_click_low_chat";
      return (
        <span
          className={`mismatch-pattern-badge ${isOrange ? "mismatch-badge-orange" : "mismatch-badge-yellow"}`}
        >
          {isOrange ? "Click > Chat" : "Chat > Reveal"}
        </span>
      );
    }

    case "budget-action": {
      const cls =
        props.action === "pause"
          ? "budget-action-pause"
          : props.action === "reduce"
            ? "budget-action-reduce"
            : props.action === "scale"
              ? "budget-action-scale"
              : "budget-action-maintain";
      return (
        <span className={`budget-action-badge ${cls}`}>
          {props.action.toUpperCase()}
        </span>
      );
    }
  }
}
