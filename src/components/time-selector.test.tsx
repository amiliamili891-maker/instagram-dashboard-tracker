import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TimeSelector } from "./time-selector";

// Mock next/navigation
const mockPush = vi.fn();
let mockSearchParams = new URLSearchParams("period=7d");

vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams,
  useRouter: () => ({ push: mockPush }),
  usePathname: () => "/dashboard",
}));

describe("TimeSelector", () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockSearchParams = new URLSearchParams("period=7d");
  });

  it("renders all period options", () => {
    render(<TimeSelector />);
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByText("Yesterday")).toBeInTheDocument();
    expect(screen.getByText("3 Days")).toBeInTheDocument();
    expect(screen.getByText("7 Days")).toBeInTheDocument();
    expect(screen.getByText("14 Days")).toBeInTheDocument();
    expect(screen.getByText("30 Days")).toBeInTheDocument();
  });

  it("marks the current period as active", () => {
    render(<TimeSelector />);
    const activeBtn = screen.getByText("7 Days");
    expect(activeBtn).toHaveAttribute("aria-checked", "true");
    expect(activeBtn.className).toContain("time-btn-active");
  });

  it("updates URL search params when a period is clicked", async () => {
    const user = userEvent.setup();
    render(<TimeSelector />);

    await user.click(screen.getByText("30 Days"));

    expect(mockPush).toHaveBeenCalledWith("/dashboard?period=30d");
  });

  it("preserves existing search params when changing period", async () => {
    mockSearchParams = new URLSearchParams("period=7d&sort=spend");
    const user = userEvent.setup();
    render(<TimeSelector />);

    await user.click(screen.getByText("Today"));

    expect(mockPush).toHaveBeenCalledWith("/dashboard?period=today&sort=spend");
  });

  it("defaults to 7d when no period param exists", () => {
    mockSearchParams = new URLSearchParams("");
    render(<TimeSelector />);
    const btn7d = screen.getByText("7 Days");
    expect(btn7d).toHaveAttribute("aria-checked", "true");
  });

  it("has radiogroup role for accessibility", () => {
    render(<TimeSelector />);
    expect(screen.getByRole("radiogroup", { name: "Time period" })).toBeInTheDocument();
  });

  it("all buttons have radio role", () => {
    render(<TimeSelector />);
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(6);
  });
});
