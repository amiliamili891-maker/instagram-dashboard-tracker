import { describe, expect, it } from "vitest";

import { parseServerEnv } from "@/lib/env";

const VALID_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  DASHBOARD_ADMIN_EMAIL: "admin@example.com",
  META_ACCESS_TOKEN: "EAAtoken123",
  META_AD_ACCOUNT_ID: "act_123456789",
  GHSTLY_PARTNER_API_KEY: "pk-test123",
};

describe("parseServerEnv", () => {
  it("returns the required Supabase, admin, Meta, and Ghstly settings", () => {
    const env = parseServerEnv(VALID_ENV);

    expect(env).toEqual({
      supabaseUrl: "https://project.supabase.co",
      supabaseAnonKey: "anon-key",
      supabaseServiceRoleKey: "service-role-key",
      adminEmail: "admin@example.com",
      metaAccessToken: "EAAtoken123",
      metaAdAccountId: "act_123456789",
      ghstlyPartnerApiKey: "pk-test123",
    });
  });

  it("throws when a required env var is missing", () => {
    expect(() =>
      parseServerEnv({
        ...VALID_ENV,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      }),
    ).toThrow("Missing required environment variable: NEXT_PUBLIC_SUPABASE_ANON_KEY");
  });

  it("throws when the admin email is malformed", () => {
    expect(() =>
      parseServerEnv({
        ...VALID_ENV,
        DASHBOARD_ADMIN_EMAIL: "not-an-email",
      }),
    ).toThrow("DASHBOARD_ADMIN_EMAIL must be a valid email address");
  });

  it("throws when META_ACCESS_TOKEN is missing", () => {
    expect(() =>
      parseServerEnv({
        ...VALID_ENV,
        META_ACCESS_TOKEN: "",
      }),
    ).toThrow("Missing required environment variable: META_ACCESS_TOKEN");
  });

  it("throws when GHSTLY_PARTNER_API_KEY is missing", () => {
    expect(() =>
      parseServerEnv({
        ...VALID_ENV,
        GHSTLY_PARTNER_API_KEY: "",
      }),
    ).toThrow("Missing required environment variable: GHSTLY_PARTNER_API_KEY");
  });
});
