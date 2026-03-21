-- Schema additions migration
-- Adds: session_messages, intelligence_alerts, daily_combined_stats tables
-- Adds: missing columns on ads, campaigns, sync_logs

-----------------------------------------------------------------------
-- 1. session_messages
-----------------------------------------------------------------------
create table if not exists public.session_messages (
  id uuid primary key default gen_random_uuid(),
  session_id text not null references public.sessions(id) on delete cascade,
  message_index integer not null,
  sender_role text not null check (sender_role in ('user', 'assistant', 'system')),
  message_text text not null,
  created_at timestamptz,
  raw jsonb,
  synced_at timestamptz not null default now(),
  unique (session_id, message_index)
);

create index if not exists session_messages_session_id_idx
  on public.session_messages (session_id);

alter table public.session_messages enable row level security;

create policy "Authenticated users can read session messages"
on public.session_messages
for select
to authenticated
using (true);

-----------------------------------------------------------------------
-- 2. intelligence_alerts
-----------------------------------------------------------------------
create table if not exists public.intelligence_alerts (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('campaign', 'adset', 'ad')),
  entity_id text not null,
  alert_type text not null check (alert_type in ('threshold', 'anomaly', 'budget', 'mismatch', 'data_quality')),
  severity text not null check (severity in ('info', 'warning', 'critical')),
  message text not null,
  data jsonb,
  sync_batch_id uuid not null,
  created_at timestamptz not null default now(),
  dismissed_at timestamptz
);

create index if not exists intelligence_alerts_entity_idx
  on public.intelligence_alerts (entity_type, entity_id);
create index if not exists intelligence_alerts_type_idx
  on public.intelligence_alerts (alert_type);
create index if not exists intelligence_alerts_created_at_idx
  on public.intelligence_alerts (created_at desc);

alter table public.intelligence_alerts enable row level security;

create policy "Authenticated users can read intelligence alerts"
on public.intelligence_alerts
for select
to authenticated
using (true);

-----------------------------------------------------------------------
-- 3. daily_combined_stats (Phase 6 placeholder)
-----------------------------------------------------------------------
create table if not exists public.daily_combined_stats (
  id uuid primary key default gen_random_uuid(),
  report_date date not null,
  entity_level text not null check (entity_level in ('campaign', 'adset', 'ad')),
  entity_id text not null,
  meta_batch_id uuid,
  ghstly_batch_id uuid,
  spend numeric(12, 4),
  impressions integer,
  clicks integer,
  unique_clicks integer,
  cpc numeric(10, 4),
  cpm numeric(10, 4),
  ctr numeric(8, 6),
  meta_conversions integer,
  cost_per_action numeric(10, 4),
  visits integer,
  chats integer,
  reveals integer,
  click_throughs integer,
  ghstly_conversions integer,
  chat_rate numeric(8, 6),
  cost_per_chat numeric(10, 4),
  reveal_rate numeric(8, 6),
  cost_per_reveal numeric(10, 4),
  reveal_click_through_rate numeric(8, 6),
  cost_per_unique_click numeric(10, 4),
  join_status text not null default 'unknown' check (join_status in ('joinable', 'unjoinable', 'partial', 'unknown')),
  freshness_state text check (freshness_state in ('fresh', 'degraded', 'stale')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (report_date, entity_level, entity_id)
);

create index if not exists daily_combined_stats_entity_day_idx
  on public.daily_combined_stats (report_date desc, entity_level);
create index if not exists daily_combined_stats_entity_id_idx
  on public.daily_combined_stats (entity_id, report_date desc);
create index if not exists daily_combined_stats_join_status_idx
  on public.daily_combined_stats (join_status, report_date desc);

create trigger daily_combined_stats_set_updated_at
before update on public.daily_combined_stats
for each row
execute function public.set_updated_at();

alter table public.daily_combined_stats enable row level security;

create policy "Authenticated users can read daily combined stats"
on public.daily_combined_stats
for select
to authenticated
using (true);

-----------------------------------------------------------------------
-- 4. Missing columns on existing tables
-----------------------------------------------------------------------
alter table public.ads
  add column if not exists creative_storage_path text;

alter table public.campaigns
  add column if not exists daily_budget numeric(12, 4);

alter table public.campaigns
  add column if not exists lifetime_budget numeric(12, 4);

alter table public.sync_logs
  add column if not exists sync_type text check (sync_type in ('scheduled', 'manual', 'backfill', 'replay'));

alter table public.sync_logs
  add column if not exists triggered_by text;
