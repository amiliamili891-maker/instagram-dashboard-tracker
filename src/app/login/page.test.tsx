import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import LoginPage from "@/app/login/page";

describe("LoginPage", () => {
  it("shows the email/password sign-in form", async () => {
    const page = await LoginPage({ searchParams: Promise.resolve({}) });
    render(page);

    expect(screen.getByRole("heading", { name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /sign in to dashboard/i }),
    ).toBeInTheDocument();
  });

  it("renders the auth error message when one is provided", async () => {
    const page = await LoginPage({ searchParams: Promise.resolve({ error: "Invalid login" }) });
    render(page);

    expect(screen.getByText("Invalid login")).toBeInTheDocument();
  });
});
