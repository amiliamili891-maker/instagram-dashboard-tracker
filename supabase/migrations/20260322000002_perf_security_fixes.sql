-- Performance: geo_breakdown RPC for server-side aggregation
create or replace function public.geo_breakdown(
  p_group_by text,
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_campaign_id text default null,
  p_adset_id text default null,
  p_ad_id text default null
)
returns table (
  location text,
  sessions bigint,
  chatted bigint,
  revealed bigint,
  clicked bigint,
  converted bigint
)
language sql
stable
security definer
as $$
  select
    coalesce(
      case p_group_by
        when 'city' then city
        when 'region' then region
        when 'country' then country
        else country
      end,
      '(unknown)'
    ) as location,
    count(*)::bigint as sessions,
    count(*) filter (where messages_count > 0)::bigint as chatted,
    count(*) filter (where reached_reveal = true)::bigint as revealed,
    count(*) filter (where clicked_through = true)::bigint as clicked,
    count(*) filter (where converted = true)::bigint as converted
  from public.sessions
  where created_at_utc >= p_date_from
    and created_at_utc <= p_date_to
    and (p_campaign_id is null or campaign_id = p_campaign_id)
    and (p_adset_id is null or adset_id = p_adset_id)
    and (p_ad_id is null or ad_id = p_ad_id)
  group by 1
  order by sessions desc;
$$;

-- Performance: composite index for the most common query pattern
create index if not exists daily_combined_stats_level_date_idx
  on public.daily_combined_stats (entity_level, report_date desc);

-- Performance: geo column indexes for future scale
create index if not exists sessions_country_idx
  on public.sessions (country, created_at_utc desc);

-- Security: disable self-registration (belt-and-suspenders via RLS)
-- Note: Also disable "Enable sign ups" in Supabase Dashboard > Authentication > Settings
-- This RLS update restricts read access to the admin email only
-- We do this by dropping the overly permissive policies and creating admin-only ones

-- Helper function to check admin email
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
as $$
  select (auth.jwt() ->> 'email') = current_setting('app.settings.admin_email', true);
$$;
