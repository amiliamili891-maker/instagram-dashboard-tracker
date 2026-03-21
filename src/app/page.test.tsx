import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

describe("Home page", () => {
  it("redirects visitors to the dashboard", async () => {
    const { default: Home } = await import("@/app/page");

    expect(() => Home()).toThrow("redirect:/dashboard");
  });
});
