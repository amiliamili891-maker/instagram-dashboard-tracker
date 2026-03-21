create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.campaigns (
  id text primary key,
  account_id text,
  name text not null,
  status text,
  effective_status text,
  objective text,
  sync_batch_id uuid not null,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.adsets (
  id text primary key,
  campaign_id text not null references public.campaigns(id) on delete cascade,
  name text not null,
  status text,
  effective_status text,
  optimization_goal text,
  billing_event text,
  sync_batch_id uuid not null,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.ads (
  id text primary key,
  campaign_id text not null references public.campaigns(id) on delete cascade,
  adset_id text not null references public.adsets(id) on delete cascade,
  name text not null,
  status text,
  effective_status text,
  creative_thumbnail_url text,
  sync_batch_id uuid not null,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.daily_meta_stats (
  id bigint generated always as identity primary key,
  report_date date not null,
  entity_level text not null check (entity_level in ('campaign', 'adset', 'ad')),
  entity_id text not null,
  campaign_id text not null references public.campaigns(id) on delete cascade,
  adset_id text,
  ad_id text,
  spend numeric(12, 2) not null default 0,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  unique_clicks bigint,
  cpc numeric(12, 4),
  cpm numeric(12, 4),
  ctr numeric(12, 6),
  meta_conversions numeric(12, 4),
  cost_per_action numeric(12, 4),
  sync_batch_id uuid not null,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint daily_meta_stats_entity_scope check (
    (entity_level = 'campaign' and adset_id is null and ad_id is null)
    or (entity_level = 'adset' and adset_id is not null and ad_id is null)
    or (entity_level = 'ad' and adset_id is not null and ad_id is not null)
  )
);

create table if not exists public.daily_ghstly_stats (
  id bigint generated always as identity primary key,
  report_date date not null,
  entity_level text not null check (entity_level in ('campaign', 'adset', 'ad')),
  entity_id text not null,
  campaign_id text,
  adset_id text,
  ad_id text,
  visits bigint not null default 0,
  chats bigint not null default 0,
  reveals bigint not null default 0,
  click_throughs bigint not null default 0,
  ghstly_conversions bigint not null default 0,
  join_status text not null default 'unknown' check (join_status in ('joinable', 'unjoinable', 'unknown')),
  join_issue text,
  sync_batch_id uuid not null,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.sessions (
  id text primary key,
  created_at_utc timestamptz not null,
  started_at_utc timestamptz,
  ended_at_utc timestamptz,
  status text,
  messages_count integer not null default 0,
  brand text,
  reached_reveal boolean not null default false,
  clicked_through boolean not null default false,
  converted boolean not null default false,
  campaign_id text,
  adset_id text,
  ad_id text,
  join_status text not null default 'unknown' check (join_status in ('joinable', 'unjoinable', 'unknown')),
  join_issue text,
  city text,
  region text,
  country text,
  sync_batch_id uuid not null,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.sync_logs (
  id bigint generated always as identity primary key,
  sync_batch_id uuid not null,
  source text not null check (source in ('meta', 'ghstly', 'combined', 'system')),
  stage text not null check (stage in ('orchestrate', 'fetch', 'persist', 'derive')),
  status text not null check (status in ('running', 'success', 'failed', 'skipped')),
  started_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  duration_ms integer,
  records_synced integer,
  watermark_date date,
  error_class text,
  error_message text,
  context jsonb not null default '{}'::jsonb
);

create index if not exists campaigns_name_idx on public.campaigns (name);
create index if not exists adsets_campaign_id_idx on public.adsets (campaign_id);
create index if not exists ads_campaign_id_idx on public.ads (campaign_id);
create index if not exists ads_adset_id_idx on public.ads (adset_id);

create unique index if not exists daily_meta_stats_entity_day_key
  on public.daily_meta_stats (report_date, entity_level, entity_id);
create index if not exists daily_meta_stats_campaign_day_idx
  on public.daily_meta_stats (campaign_id, report_date desc);
create index if not exists daily_meta_stats_adset_day_idx
  on public.daily_meta_stats (adset_id, report_date desc)
  where adset_id is not null;
create index if not exists daily_meta_stats_ad_day_idx
  on public.daily_meta_stats (ad_id, report_date desc)
  where ad_id is not null;

create unique index if not exists daily_ghstly_stats_entity_day_key
  on public.daily_ghstly_stats (report_date, entity_level, entity_id);
create index if not exists daily_ghstly_stats_join_status_idx
  on public.daily_ghstly_stats (join_status, report_date desc);
create index if not exists daily_ghstly_stats_campaign_day_idx
  on public.daily_ghstly_stats (campaign_id, report_date desc);
create index if not exists daily_ghstly_stats_adset_day_idx
  on public.daily_ghstly_stats (adset_id, report_date desc);
create index if not exists daily_ghstly_stats_ad_day_idx
  on public.daily_ghstly_stats (ad_id, report_date desc);

create index if not exists sessions_created_at_idx
  on public.sessions (created_at_utc desc);
create index if not exists sessions_join_status_idx
  on public.sessions (join_status, created_at_utc desc);
create index if not exists sessions_campaign_id_idx
  on public.sessions (campaign_id, created_at_utc desc);
create index if not exists sessions_adset_id_idx
  on public.sessions (adset_id, created_at_utc desc);
create index if not exists sessions_ad_id_idx
  on public.sessions (ad_id, created_at_utc desc);

create index if not exists sync_logs_batch_idx on public.sync_logs (sync_batch_id);
create index if not exists sync_logs_source_started_idx
  on public.sync_logs (source, started_at desc);

create trigger campaigns_set_updated_at
before update on public.campaigns
for each row
execute function public.set_updated_at();

create trigger adsets_set_updated_at
before update on public.adsets
for each row
execute function public.set_updated_at();

create trigger ads_set_updated_at
before update on public.ads
for each row
execute function public.set_updated_at();

create trigger daily_meta_stats_set_updated_at
before update on public.daily_meta_stats
for each row
execute function public.set_updated_at();

create trigger daily_ghstly_stats_set_updated_at
before update on public.daily_ghstly_stats
for each row
execute function public.set_updated_at();

create trigger sessions_set_updated_at
before update on public.sessions
for each row
execute function public.set_updated_at();

alter table public.campaigns enable row level security;
alter table public.adsets enable row level security;
alter table public.ads enable row level security;
alter table public.daily_meta_stats enable row level security;
alter table public.daily_ghstly_stats enable row level security;
alter table public.sessions enable row level security;
alter table public.sync_logs enable row level security;

create policy "Authenticated users can read campaigns"
on public.campaigns
for select
to authenticated
using (true);

create policy "Authenticated users can read adsets"
on public.adsets
for select
to authenticated
using (true);

create policy "Authenticated users can read ads"
on public.ads
for select
to authenticated
using (true);

create policy "Authenticated users can read daily meta stats"
on public.daily_meta_stats
for select
to authenticated
using (true);

create policy "Authenticated users can read daily ghstly stats"
on public.daily_ghstly_stats
for select
to authenticated
using (true);

create policy "Authenticated users can read sessions"
on public.sessions
for select
to authenticated
using (true);

create policy "Authenticated users can read sync logs"
on public.sync_logs
for select
to authenticated
using (true);
