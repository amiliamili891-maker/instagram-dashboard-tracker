import { describe, expect, it } from "vitest";

import { isAdminEmail } from "@/lib/auth/admin";

describe("isAdminEmail", () => {
  it("matches the configured admin email case-insensitively", () => {
    expect(isAdminEmail("Admin@Example.com", "admin@example.com")).toBe(true);
  });

  it("returns false when the user email is missing", () => {
    expect(isAdminEmail(null, "admin@example.com")).toBe(false);
  });

  it("returns false when the configured admin email is blank", () => {
    expect(isAdminEmail("admin@example.com", "")).toBe(false);
  });
});
