import { describe, expect, it, vi } from "vitest";

import { requireAdminUser, requireAuthenticatedUser } from "@/lib/auth/guards";

const redirectMock = vi.fn<(path: string) => never>();

describe("requireAuthenticatedUser", () => {
  it("returns the current user when an email is present", async () => {
    const user = await requireAuthenticatedUser(
      async () => ({ email: "admin@example.com" }),
      redirectMock,
    );

    expect(user.email).toBe("admin@example.com");
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("redirects to login when no authenticated user is available", async () => {
    redirectMock.mockImplementation((path: string) => {
      throw new Error(`redirect:${path}`);
    });

    await expect(
      requireAuthenticatedUser(async () => null, redirectMock),
    ).rejects.toThrow("redirect:/login");
  });
});

describe("requireAdminUser", () => {
  it("returns the current user when the email matches the configured admin", async () => {
    const user = await requireAdminUser(
      async () => ({ email: "admin@example.com" }),
      "admin@example.com",
      redirectMock,
    );

    expect(user.email).toBe("admin@example.com");
  });

  it("redirects to login with an error when a non-admin user signs in", async () => {
    redirectMock.mockImplementation((path: string) => {
      throw new Error(`redirect:${path}`);
    });

    await expect(
      requireAdminUser(
        async () => ({ email: "viewer@example.com" }),
        "admin@example.com",
        redirectMock,
      ),
    ).rejects.toThrow("redirect:/login?error=Access%20denied");
  });
});
