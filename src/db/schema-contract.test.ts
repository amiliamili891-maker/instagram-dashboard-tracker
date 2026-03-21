import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function readMigration(index: number) {
  const migrationsDir = path.join(process.cwd(), "supabase", "migrations");
  const migrationFiles = readdirSync(migrationsDir)
    .filter((entry) => entry.endsWith(".sql"))
    .sort();

  if (migrationFiles.length === 0) {
    throw new Error("No Supabase migration files found");
  }

  const filePath = path.join(migrationsDir, migrationFiles.at(index)!);
  return readFileSync(filePath, "utf8");
}

function readAllMigrations() {
  const migrationsDir = path.join(process.cwd(), "supabase", "migrations");
  const migrationFiles = readdirSync(migrationsDir)
    .filter((entry) => entry.endsWith(".sql"))
    .sort();

  if (migrationFiles.length === 0) {
    throw new Error("No Supabase migration files found");
  }

  return migrationFiles
    .map((f) => readFileSync(path.join(migrationsDir, f), "utf8"))
    .join("\n");
}

describe("core schema migration", () => {
  it("defines every Phase 1 core table", () => {
    const sql = readMigration(0);

    for (const table of [
      "campaigns",
      "adsets",
      "ads",
      "daily_meta_stats",
      "daily_ghstly_stats",
      "sessions",
      "sync_logs",
    ]) {
      expect(sql).toContain(`create table if not exists public.${table}`);
    }
  });

  it("includes lineage, join-quality, and row-level security controls", () => {
    const sql = readMigration(0);

    expect(sql).toContain("sync_batch_id uuid not null");
    expect(sql).toContain("join_status text");
    expect(sql).toContain("alter table public.daily_meta_stats enable row level security");
    expect(sql).toContain("alter table public.daily_ghstly_stats enable row level security");
    expect(sql).toContain("create policy \"Authenticated users can read sync logs\"");
  });
});

describe("schema additions migration", () => {
  it("defines session_messages, intelligence_alerts, and daily_combined_stats tables", () => {
    const sql = readAllMigrations();

    for (const table of [
      "session_messages",
      "intelligence_alerts",
      "daily_combined_stats",
    ]) {
      expect(sql).toContain(`create table if not exists public.${table}`);
    }
  });

  it("enables RLS and adds read policies for new tables", () => {
    const sql = readAllMigrations();

    for (const table of [
      "session_messages",
      "intelligence_alerts",
      "daily_combined_stats",
    ]) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
    }

    expect(sql).toContain("Authenticated users can read session messages");
    expect(sql).toContain("Authenticated users can read intelligence alerts");
    expect(sql).toContain("Authenticated users can read daily combined stats");
  });

  it("adds missing columns to existing tables", () => {
    const sql = readAllMigrations();

    expect(sql).toContain("add column if not exists creative_storage_path text");
    expect(sql).toContain("add column if not exists daily_budget");
    expect(sql).toContain("add column if not exists lifetime_budget");
    expect(sql).toContain("add column if not exists sync_type text");
    expect(sql).toContain("add column if not exists triggered_by text");
  });
});
