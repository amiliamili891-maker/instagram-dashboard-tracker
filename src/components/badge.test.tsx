import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "./badge";

describe("Badge", () => {
  // ---------------------------------------------------------------------------
  // Tier variant
  // ---------------------------------------------------------------------------
  describe("variant=tier", () => {
    it("renders with correct class names and text", () => {
      render(<Badge variant="tier" tier="Perfect" color="green" />);
      const el = screen.getByText("Perfect");
      expect(el).toHaveClass("tier-badge", "tier-green", "tier-badge-sm");
    });

    it("supports md size", () => {
      render(<Badge variant="tier" tier="Poor" color="red" size="md" />);
      const el = screen.getByText("Poor");
      expect(el).toHaveClass("tier-badge-md");
    });
  });

  // ---------------------------------------------------------------------------
  // Freshness variant
  // ---------------------------------------------------------------------------
  describe("variant=freshness", () => {
    it("renders FRESH state with correct class", () => {
      render(<Badge variant="freshness" state="fresh" />);
      const el = screen.getByText("FRESH");
      expect(el).toHaveClass("freshness-badge", "badge-fresh");
    });

    it("renders degraded state", () => {
      render(<Badge variant="freshness" state="degraded" />);
      const el = screen.getByText("DEGRADED");
      expect(el).toHaveClass("badge-degraded");
    });

    it("renders stale state", () => {
      render(<Badge variant="freshness" state="stale" />);
      const el = screen.getByText("STALE");
      expect(el).toHaveClass("badge-stale");
    });

    it("falls back to badge-stale for unknown state", () => {
      render(<Badge variant="freshness" state="unknown" />);
      const el = screen.getByText("UNKNOWN");
      expect(el).toHaveClass("badge-stale");
    });
  });

  // ---------------------------------------------------------------------------
  // Severity variant
  // ---------------------------------------------------------------------------
  describe("variant=severity", () => {
    it("renders critical severity", () => {
      render(<Badge variant="severity" severity="critical" />);
      const el = screen.getByText("critical");
      expect(el).toHaveClass("severity-badge", "badge-critical");
    });

    it("renders warning severity", () => {
      render(<Badge variant="severity" severity="warning" />);
      expect(screen.getByText("warning")).toHaveClass("badge-warning");
    });

    it("falls back to badge-info for unknown", () => {
      render(<Badge variant="severity" severity="something" />);
      expect(screen.getByText("something")).toHaveClass("badge-info");
    });
  });

  // ---------------------------------------------------------------------------
  // Action variant
  // ---------------------------------------------------------------------------
  describe("variant=action", () => {
    it("renders pause action", () => {
      render(<Badge variant="action" action="pause" />);
      expect(screen.getByText("pause")).toHaveClass("action-badge", "badge-action-pause");
    });

    it("maps increase to scale class", () => {
      render(<Badge variant="action" action="increase" />);
      expect(screen.getByText("increase")).toHaveClass("badge-action-scale");
    });

    it("falls back to maintain for unknown action", () => {
      render(<Badge variant="action" action="custom" />);
      expect(screen.getByText("custom")).toHaveClass("badge-action-maintain");
    });
  });

  // ---------------------------------------------------------------------------
  // Status variant
  // ---------------------------------------------------------------------------
  describe("variant=status", () => {
    it("renders status badge with dynamic class", () => {
      render(<Badge variant="status" status="success" />);
      const el = screen.getByText("success");
      expect(el).toHaveClass("status-badge", "status-success");
    });
  });

  // ---------------------------------------------------------------------------
  // Funnel variant
  // ---------------------------------------------------------------------------
  describe("variant=funnel", () => {
    it("renders funnel badge with step-based class", () => {
      render(<Badge variant="funnel" step="chatted" />);
      const el = screen.getByText("chatted");
      expect(el).toHaveClass("funnel-badge", "funnel-chatted");
    });
  });

  // ---------------------------------------------------------------------------
  // Join variant
  // ---------------------------------------------------------------------------
  describe("variant=join", () => {
    it("renders join badge", () => {
      render(<Badge variant="join" joinStatus="matched" />);
      const el = screen.getByText("matched");
      expect(el).toHaveClass("join-badge", "join-matched");
    });
  });

  // ---------------------------------------------------------------------------
  // Mismatch-pattern variant
  // ---------------------------------------------------------------------------
  describe("variant=mismatch-pattern", () => {
    it("renders orange for high_click_low_chat", () => {
      render(<Badge variant="mismatch-pattern" pattern="high_click_low_chat" />);
      const el = screen.getByText("Click > Chat");
      expect(el).toHaveClass("mismatch-pattern-badge", "mismatch-badge-orange");
    });

    it("renders yellow for other patterns", () => {
      render(<Badge variant="mismatch-pattern" pattern="high_chat_low_reveal" />);
      const el = screen.getByText("Chat > Reveal");
      expect(el).toHaveClass("mismatch-badge-yellow");
    });
  });

  // ---------------------------------------------------------------------------
  // Budget-action variant
  // ---------------------------------------------------------------------------
  describe("variant=budget-action", () => {
    it("renders PAUSE uppercased with correct class", () => {
      render(<Badge variant="budget-action" action="pause" />);
      const el = screen.getByText("PAUSE");
      expect(el).toHaveClass("budget-action-badge", "budget-action-pause");
    });

    it("renders SCALE", () => {
      render(<Badge variant="budget-action" action="scale" />);
      expect(screen.getByText("SCALE")).toHaveClass("budget-action-scale");
    });

    it("falls back to maintain for unknown action", () => {
      render(<Badge variant="budget-action" action="custom" />);
      expect(screen.getByText("CUSTOM")).toHaveClass("budget-action-maintain");
    });
  });
});
