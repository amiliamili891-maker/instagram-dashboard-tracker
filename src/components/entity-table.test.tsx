import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EntityTable, type EntityRow, type TierInfo } from "./entity-table";

// Mock SparklineCell — it uses Recharts which doesn't render in jsdom
vi.mock("@/components/sparkline-cell", () => ({
  SparklineCell: ({ data }: { data: (number | null)[] }) => (
    <span data-testid="sparkline">{data.length} points</span>
  ),
}));

// Mock next/link
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

function makeRow(overrides: Partial<EntityRow> & { id: string; name: string }): EntityRow {
  return {
    spend: 100,
    impressions: 1000,
    clicks: 50,
    chats: 10,
    visits: 200,
    reveals: 5,
    cost_per_chat: 10,
    chat_rate: 0.05,
    reveal_rate: 0.5,
    dailyCostPerChat: [10, 12, 8],
    ...overrides,
  };
}

const sampleRows: EntityRow[] = [
  makeRow({ id: "c1", name: "Campaign Alpha", spend: 200 }),
  makeRow({ id: "c2", name: "Campaign Beta", spend: 50 }),
  makeRow({ id: "c3", name: "Campaign Gamma", spend: 150, dailyCostPerChat: [5] }),
];

const sampleTiers = new Map<string, TierInfo>([
  ["c1", { tier: "Perfect", color: "green" }],
  ["c3", { tier: "Poor", color: "red" }],
]);

describe("EntityTable", () => {
  it("renders empty message when no rows", () => {
    render(
      <EntityTable
        rows={[]}
        tiers={new Map()}
        period="7d"
        nameLabel="Campaign"
        buildHref={(row, p) => `/campaigns/${row.id}?period=${p}`}
        emptyMessage="No campaigns found."
      />,
    );
    expect(screen.getByText("No campaigns found.")).toBeInTheDocument();
  });

  it("renders rows with correct entity links", () => {
    render(
      <EntityTable
        rows={sampleRows}
        tiers={sampleTiers}
        period="7d"
        nameLabel="Campaign"
        buildHref={(row, p) => `/campaigns/${row.id}?period=${p}`}
      />,
    );

    const link = screen.getByText("Campaign Alpha").closest("a");
    expect(link).toHaveAttribute("href", "/campaigns/c1?period=7d");
  });

  it("renders tier badges for rows with tier data", () => {
    render(
      <EntityTable
        rows={sampleRows}
        tiers={sampleTiers}
        period="7d"
        nameLabel="Campaign"
        buildHref={(row, p) => `/campaigns/${row.id}?period=${p}`}
      />,
    );

    expect(screen.getByText("Perfect")).toHaveClass("tier-badge", "tier-green");
    expect(screen.getByText("Poor")).toHaveClass("tier-badge", "tier-red");
    // c2 has no tier — should show "--"
    const dashes = screen.getAllByText("--");
    expect(dashes.length).toBeGreaterThanOrEqual(1);
  });

  it("renders sparklines for rows with 2+ data points", () => {
    render(
      <EntityTable
        rows={sampleRows}
        tiers={new Map()}
        period="7d"
        nameLabel="Campaign"
        buildHref={(row, p) => `/campaigns/${row.id}?period=${p}`}
      />,
    );

    const sparklines = screen.getAllByTestId("sparkline");
    // c1 and c2 have 3 data points, c3 has only 1 (so no sparkline)
    expect(sparklines).toHaveLength(2);
  });

  it("renders thumbnail column when renderThumbnail is provided", () => {
    render(
      <EntityTable
        rows={sampleRows}
        tiers={new Map()}
        period="7d"
        nameLabel="Ad"
        buildHref={(row, p) => `/ads/${row.id}?period=${p}`}
        renderThumbnail={(row) => <img data-testid={`thumb-${row.id}`} alt="" />}
      />,
    );

    expect(screen.getByTestId("thumb-c1")).toBeInTheDocument();
    expect(screen.getByTestId("thumb-c2")).toBeInTheDocument();
    expect(screen.getByTestId("thumb-c3")).toBeInTheDocument();
  });

  it("does not render thumbnail column when renderThumbnail is not provided", () => {
    const { container } = render(
      <EntityTable
        rows={sampleRows}
        tiers={new Map()}
        period="7d"
        nameLabel="Campaign"
        buildHref={(row, p) => `/campaigns/${row.id}?period=${p}`}
      />,
    );

    // No thumbnail-cell in header
    const headerCells = container.querySelectorAll("thead th");
    const thumbnailHeaders = Array.from(headerCells).filter((th) =>
      th.classList.contains("thumbnail-cell"),
    );
    expect(thumbnailHeaders).toHaveLength(0);
  });

  it("sorts rows by spend descending by default", () => {
    const { container } = render(
      <EntityTable
        rows={sampleRows}
        tiers={new Map()}
        period="7d"
        nameLabel="Campaign"
        buildHref={(row, p) => `/campaigns/${row.id}?period=${p}`}
      />,
    );

    const links = container.querySelectorAll(".entity-link");
    // Default sort by spend desc: Alpha(200), Gamma(150), Beta(50)
    expect(links[0]).toHaveTextContent("Campaign Alpha");
    expect(links[1]).toHaveTextContent("Campaign Gamma");
    expect(links[2]).toHaveTextContent("Campaign Beta");
  });

  it("uses correct name label in header", () => {
    render(
      <EntityTable
        rows={sampleRows}
        tiers={new Map()}
        period="7d"
        nameLabel="Adset"
        buildHref={(row, p) => `/adsets/${row.id}?period=${p}`}
      />,
    );

    expect(screen.getByText("Adset")).toBeInTheDocument();
  });

  it("renders all metric columns", () => {
    render(
      <EntityTable
        rows={sampleRows}
        tiers={new Map()}
        period="7d"
        nameLabel="Campaign"
        buildHref={(row, p) => `/campaigns/${row.id}?period=${p}`}
      />,
    );

    expect(screen.getByText("Spend")).toBeInTheDocument();
    expect(screen.getByText("Cost/Chat")).toBeInTheDocument();
    expect(screen.getByText("Chat Rate")).toBeInTheDocument();
    expect(screen.getByText("Reveal Rate")).toBeInTheDocument();
    expect(screen.getByText("Chats")).toBeInTheDocument();
    expect(screen.getByText("Visits")).toBeInTheDocument();
    expect(screen.getByText("Reveals")).toBeInTheDocument();
    expect(screen.getByText("Impressions")).toBeInTheDocument();
    expect(screen.getByText("Clicks")).toBeInTheDocument();
  });
});
