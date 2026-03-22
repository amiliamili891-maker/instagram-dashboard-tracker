import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FunnelChart, type FunnelStep } from "./funnel-chart";

describe("FunnelChart", () => {
  const sampleSteps: FunnelStep[] = [
    { label: "Visits", value: 10000 },
    { label: "Chats", value: 3000 },
    { label: "Reveals", value: 900 },
    { label: "Clicks", value: 200 },
  ];

  it("renders all funnel steps with labels", () => {
    render(<FunnelChart steps={sampleSteps} />);
    expect(screen.getByText("Visits")).toBeInTheDocument();
    expect(screen.getByText("Chats")).toBeInTheDocument();
    expect(screen.getByText("Reveals")).toBeInTheDocument();
    expect(screen.getByText("Clicks")).toBeInTheDocument();
  });

  it("renders formatted values inside bars", () => {
    render(<FunnelChart steps={sampleSteps} />);
    expect(screen.getByText("10.0K")).toBeInTheDocument();
    expect(screen.getByText("3.0K")).toBeInTheDocument();
    expect(screen.getByText("900")).toBeInTheDocument();
    expect(screen.getByText("200")).toBeInTheDocument();
  });

  it("shows drop-off percentages between steps", () => {
    render(<FunnelChart steps={sampleSteps} />);
    // Chats/Visits = 3000/10000 = 30.0%
    expect(screen.getByTestId("funnel-dropoff-chats")).toHaveTextContent("30.0%");
    // Reveals/Chats = 900/3000 = 30.0%
    expect(screen.getByTestId("funnel-dropoff-reveals")).toHaveTextContent("30.0%");
    // Clicks/Reveals = 200/900 = 22.2%
    expect(screen.getByTestId("funnel-dropoff-clicks")).toHaveTextContent("22.2%");
  });

  it("does not show drop-off for the first step", () => {
    render(<FunnelChart steps={sampleSteps} />);
    expect(screen.queryByTestId("funnel-dropoff-visits")).not.toBeInTheDocument();
  });

  it("renders empty state when all values are null", () => {
    const nullSteps: FunnelStep[] = [
      { label: "Visits", value: null },
      { label: "Chats", value: null },
    ];
    render(<FunnelChart steps={nullSteps} />);
    expect(screen.getByText("No funnel data available for this period.")).toBeInTheDocument();
  });

  it("filters out steps with null values", () => {
    const partialSteps: FunnelStep[] = [
      { label: "Visits", value: 5000 },
      { label: "Chats", value: 1500 },
      { label: "Reveals", value: null },
      { label: "Clicks", value: 100 },
    ];
    render(<FunnelChart steps={partialSteps} />);
    expect(screen.getByText("Visits")).toBeInTheDocument();
    expect(screen.getByText("Chats")).toBeInTheDocument();
    expect(screen.queryByText("Reveals")).not.toBeInTheDocument();
    expect(screen.getByText("Clicks")).toBeInTheDocument();
  });

  it("sets bar width proportional to max value", () => {
    render(<FunnelChart steps={sampleSteps} />);
    const visitsBar = screen.getByTestId("funnel-bar-visits");
    const chatsBar = screen.getByTestId("funnel-bar-chats");
    // Visits = max, so 100% width
    expect(visitsBar.style.width).toBe("100%");
    // Chats = 3000/10000 = 30%
    expect(chatsBar.style.width).toBe("30%");
  });

  it("enforces minimum bar width of 4%", () => {
    const tinySteps: FunnelStep[] = [
      { label: "Visits", value: 100000 },
      { label: "Chats", value: 10 },
    ];
    render(<FunnelChart steps={tinySteps} />);
    const chatsBar = screen.getByTestId("funnel-bar-chats");
    // 10/100000 = 0.01% which is < 4%, so should be 4%
    expect(chatsBar.style.width).toBe("4%");
  });

  it("formats large numbers with M suffix", () => {
    const bigSteps: FunnelStep[] = [
      { label: "Visits", value: 2500000 },
    ];
    render(<FunnelChart steps={bigSteps} />);
    expect(screen.getByText("2.5M")).toBeInTheDocument();
  });

  it("has correct aria label", () => {
    render(<FunnelChart steps={sampleSteps} />);
    expect(screen.getByRole("figure", { name: "Conversion funnel" })).toBeInTheDocument();
  });

  it("handles zero values in drop-off calculation", () => {
    // When passed from the page, 0 values become null via `|| null`
    // But the component should handle 0 gracefully if passed directly
    const zeroSteps: FunnelStep[] = [
      { label: "Visits", value: 100 },
      { label: "Chats", value: 0 },
    ];
    render(<FunnelChart steps={zeroSteps} />);
    // 0 is not null, so it renders. Drop-off = 0/100 = 0%
    expect(screen.getByTestId("funnel-dropoff-chats")).toHaveTextContent("0%");
  });
});
