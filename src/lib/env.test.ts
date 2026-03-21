import { describe, expect, it } from "vitest";

import { parseServerEnv } from "@/lib/env";

describe("parseServerEnv", () => {
  it("returns the required Supabase and admin settings", () => {
    const env = parseServerEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
      DASHBOARD_ADMIN_EMAIL: "admin@example.com",
    });

    expect(env).toEqual({
      supabaseUrl: "https://project.supabase.co",
      supabaseAnonKey: "anon-key",
      adminEmail: "admin@example.com",
    });
  });

  it("throws when a required env var is missing", () => {
    expect(() =>
      parseServerEnv({
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
        DASHBOARD_ADMIN_EMAIL: "admin@example.com",
      }),
    ).toThrow("Missing required environment variable: NEXT_PUBLIC_SUPABASE_ANON_KEY");
  });

  it("throws when the admin email is malformed", () => {
    expect(() =>
      parseServerEnv({
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
        DASHBOARD_ADMIN_EMAIL: "not-an-email",
      }),
    ).toThrow("DASHBOARD_ADMIN_EMAIL must be a valid email address");
  });
});
