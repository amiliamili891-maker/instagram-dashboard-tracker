import { z } from "zod";

const serverEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  DASHBOARD_ADMIN_EMAIL: z.email(),
  META_ACCESS_TOKEN: z.string().min(1),
  META_AD_ACCOUNT_ID: z.string().min(1),
  GHSTLY_PARTNER_API_KEY: z.string().min(1),
});

type ServerEnvKey = keyof z.input<typeof serverEnvSchema>;
type ServerEnvInput = Record<string, string | undefined>;

export type ServerEnv = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
  adminEmail: string;
  metaAccessToken: string;
  metaAdAccountId: string;
  ghstlyPartnerApiKey: string;
};

function getRequiredValue(
  source: ServerEnvInput,
  key: ServerEnvKey,
) {
  const value = source[key]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}

export function parseServerEnv(source: ServerEnvInput): ServerEnv {
  const raw = {
    NEXT_PUBLIC_SUPABASE_URL: getRequiredValue(source, "NEXT_PUBLIC_SUPABASE_URL"),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: getRequiredValue(
      source,
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    ),
    SUPABASE_SERVICE_ROLE_KEY: getRequiredValue(source, "SUPABASE_SERVICE_ROLE_KEY"),
    DASHBOARD_ADMIN_EMAIL: getRequiredValue(source, "DASHBOARD_ADMIN_EMAIL"),
    META_ACCESS_TOKEN: getRequiredValue(source, "META_ACCESS_TOKEN"),
    META_AD_ACCOUNT_ID: getRequiredValue(source, "META_AD_ACCOUNT_ID"),
    GHSTLY_PARTNER_API_KEY: getRequiredValue(source, "GHSTLY_PARTNER_API_KEY"),
  };

  const parsed = serverEnvSchema.safeParse(raw);

  if (!parsed.success) {
    const issue = parsed.error.issues[0];

    if (issue?.path[0] === "DASHBOARD_ADMIN_EMAIL") {
      throw new Error("DASHBOARD_ADMIN_EMAIL must be a valid email address");
    }

    throw new Error(
      `Invalid environment variable: ${String(issue?.path[0] ?? "unknown")}`,
    );
  }

  return {
    supabaseUrl: parsed.data.NEXT_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: parsed.data.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    supabaseServiceRoleKey: parsed.data.SUPABASE_SERVICE_ROLE_KEY,
    adminEmail: parsed.data.DASHBOARD_ADMIN_EMAIL,
    metaAccessToken: parsed.data.META_ACCESS_TOKEN,
    metaAdAccountId: parsed.data.META_AD_ACCOUNT_ID,
    ghstlyPartnerApiKey: parsed.data.GHSTLY_PARTNER_API_KEY,
  };
}

export function getServerEnv() {
  return parseServerEnv(process.env as ServerEnvInput);
}
