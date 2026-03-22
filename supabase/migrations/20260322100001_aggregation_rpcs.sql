-- Aggregation RPC functions
-- Moves client-side JavaScript aggregation to server-side Postgres for 10-100x less data transfer

-----------------------------------------------------------------------
-- 1. aggregate_kpis: Single-row KPI summary for a date range
-----------------------------------------------------------------------
create or replace function public.aggregate_kpis(
  date_from date,
  date_to date
)
returns table (
  spend numeric,
  impressions bigint,
  clicks bigint,
  unique_clicks bigint,
  chats bigint,
  visits bigint,
  reveals bigint,
  click_throughs bigint,
  chat_rate numeric,
  cost_per_chat numeric,
  reveal_rate numeric,
  cost_per_reveal numeric,
  ctr numeric,
  cpc numeric,
  cpm numeric,
  cost_per_unique_click numeric,
  reveal_click_through_rate numeric
)
language sql stable
as $$
  select
    coalesce(sum(d.spend), 0)::numeric as spend,
    coalesce(sum(d.impressions), 0)::bigint as impressions,
    coalesce(sum(d.clicks), 0)::bigint as clicks,
    coalesce(sum(d.unique_clicks), 0)::bigint as unique_clicks,
    coalesce(sum(d.chats), 0)::bigint as chats,
    coalesce(sum(d.visits), 0)::bigint as visits,
    coalesce(sum(d.reveals), 0)::bigint as reveals,
    coalesce(sum(d.click_throughs), 0)::bigint as click_throughs,
    -- derived rates
    case when coalesce(sum(d.visits), 0) = 0 then null
         else sum(d.chats)::numeric / sum(d.visits)
    end as chat_rate,
    case when coalesce(sum(d.chats), 0) = 0 then null
         else sum(d.spend) / sum(d.chats)
    end as cost_per_chat,
    case when coalesce(sum(d.chats), 0) = 0 then null
         else sum(d.reveals)::numeric / sum(d.chats)
    end as reveal_rate,
    case when coalesce(sum(d.reveals), 0) = 0 then null
         else sum(d.spend) / sum(d.reveals)
    end as cost_per_reveal,
    case when coalesce(sum(d.impressions), 0) = 0 then null
         else sum(d.clicks)::numeric / sum(d.impressions)
    end as ctr,
    case when coalesce(sum(d.clicks), 0) = 0 then null
         else sum(d.spend) / sum(d.clicks)
    end as cpc,
    case when coalesce(sum(d.impressions), 0) = 0 then null
         else (sum(d.spend) / sum(d.impressions)) * 1000
    end as cpm,
    case when coalesce(sum(d.unique_clicks), 0) = 0 then null
         else sum(d.spend) / sum(d.unique_clicks)
    end as cost_per_unique_click,
    case when coalesce(sum(d.reveals), 0) = 0 then null
         else sum(d.click_throughs)::numeric / sum(d.reveals)
    end as reveal_click_through_rate
  from public.daily_combined_stats d
  where d.entity_level = 'ad'
    and d.report_date >= date_from
    and d.report_date <= date_to;
$$;

-----------------------------------------------------------------------
-- 2. aggregate_scorecard: Per-entity aggregation for scorecard
-----------------------------------------------------------------------
create or replace function public.aggregate_scorecard(
  date_from date,
  date_to date
)
returns table (
  entity_id text,
  spend numeric,
  chats bigint,
  visits bigint,
  reveals bigint,
  impressions bigint,
  clicks bigint,
  unique_clicks bigint,
  click_throughs bigint,
  cost_per_chat numeric,
  chat_rate numeric,
  reveal_rate numeric,
  ctr numeric,
  cpc numeric
)
language sql stable
as $$
  select
    d.entity_id,
    coalesce(sum(d.spend), 0)::numeric as spend,
    coalesce(sum(d.chats), 0)::bigint as chats,
    coalesce(sum(d.visits), 0)::bigint as visits,
    coalesce(sum(d.reveals), 0)::bigint as reveals,
    coalesce(sum(d.impressions), 0)::bigint as impressions,
    coalesce(sum(d.clicks), 0)::bigint as clicks,
    coalesce(sum(d.unique_clicks), 0)::bigint as unique_clicks,
    coalesce(sum(d.click_throughs), 0)::bigint as click_throughs,
    -- derived
    case when coalesce(sum(d.chats), 0) = 0 then null
         else sum(d.spend) / sum(d.chats)
    end as cost_per_chat,
    case when coalesce(sum(d.visits), 0) = 0 then null
         else sum(d.chats)::numeric / sum(d.visits)
    end as chat_rate,
    case when coalesce(sum(d.chats), 0) = 0 then null
         else sum(d.reveals)::numeric / sum(d.chats)
    end as reveal_rate,
    case when coalesce(sum(d.impressions), 0) = 0 then null
         else sum(d.clicks)::numeric / sum(d.impressions)
    end as ctr,
    case when coalesce(sum(d.clicks), 0) = 0 then null
         else sum(d.spend) / sum(d.clicks)
    end as cpc
  from public.daily_combined_stats d
  where d.entity_level = 'ad'
    and d.report_date >= date_from
    and d.report_date <= date_to
  group by d.entity_id;
$$;

-----------------------------------------------------------------------
-- 3. aggregate_trends: Daily time series for a single metric
-----------------------------------------------------------------------
create or replace function public.aggregate_trends(
  date_from date,
  date_to date,
  metric_name text
)
returns table (
  report_date date,
  metric_value numeric
)
language plpgsql stable
as $$
begin
  return query
  select
    d.report_date,
    case metric_name
      -- additive metrics: SUM
      when 'spend' then sum(d.spend)
      when 'impressions' then sum(d.impressions)::numeric
      when 'clicks' then sum(d.clicks)::numeric
      when 'unique_clicks' then sum(d.unique_clicks)::numeric
      when 'visits' then sum(d.visits)::numeric
      when 'chats' then sum(d.chats)::numeric
      when 'reveals' then sum(d.reveals)::numeric
      when 'click_throughs' then sum(d.click_throughs)::numeric
      when 'ghstly_conversions' then sum(d.ghstly_conversions)::numeric
      when 'meta_conversions' then sum(d.meta_conversions)::numeric
      -- rate/derived metrics: compute from summed components
      when 'chat_rate' then
        case when coalesce(sum(d.visits), 0) = 0 then null
             else sum(d.chats)::numeric / sum(d.visits)
        end
      when 'cost_per_chat' then
        case when coalesce(sum(d.chats), 0) = 0 then null
             else sum(d.spend) / sum(d.chats)
        end
      when 'reveal_rate' then
        case when coalesce(sum(d.chats), 0) = 0 then null
             else sum(d.reveals)::numeric / sum(d.chats)
        end
      when 'cost_per_reveal' then
        case when coalesce(sum(d.reveals), 0) = 0 then null
             else sum(d.spend) / sum(d.reveals)
        end
      when 'reveal_click_through_rate' then
        case when coalesce(sum(d.reveals), 0) = 0 then null
             else sum(d.click_throughs)::numeric / sum(d.reveals)
        end
      when 'ctr' then
        case when coalesce(sum(d.impressions), 0) = 0 then null
             else sum(d.clicks)::numeric / sum(d.impressions)
        end
      when 'cpc' then
        case when coalesce(sum(d.clicks), 0) = 0 then null
             else sum(d.spend) / sum(d.clicks)
        end
      when 'cpm' then
        case when coalesce(sum(d.impressions), 0) = 0 then null
             else (sum(d.spend) / sum(d.impressions)) * 1000
        end
      when 'cost_per_unique_click' then
        case when coalesce(sum(d.unique_clicks), 0) = 0 then null
             else sum(d.spend) / sum(d.unique_clicks)
        end
      when 'cost_per_action' then
        case when coalesce(sum(d.meta_conversions), 0) = 0 then null
             else sum(d.spend) / sum(d.meta_conversions)
        end
      else null
    end as metric_value
  from public.daily_combined_stats d
  where d.entity_level = 'ad'
    and d.report_date >= aggregate_trends.date_from
    and d.report_date <= aggregate_trends.date_to
  group by d.report_date
  order by d.report_date asc;
end;
$$;

-----------------------------------------------------------------------
-- 4. aggregate_geo: Geo breakdown from sessions table
-----------------------------------------------------------------------
create or replace function public.aggregate_geo(
  date_from date,
  date_to date,
  group_by_field text
)
returns table (
  group_name text,
  sessions bigint,
  chatted bigint,
  revealed bigint,
  clicked bigint,
  converted bigint
)
language plpgsql stable
as $$
begin
  return query
  select
    coalesce(
      case group_by_field
        when 'city' then s.city
        when 'region' then s.region
        when 'country' then s.country
        else null
      end,
      '(unknown)'
    ) as group_name,
    count(*)::bigint as sessions,
    count(*) filter (where s.messages_count > 0)::bigint as chatted,
    count(*) filter (where s.reached_reveal)::bigint as revealed,
    count(*) filter (where s.clicked_through)::bigint as clicked,
    count(*) filter (where s.converted)::bigint as converted
  from public.sessions s
  where s.created_at_utc >= (aggregate_geo.date_from::timestamp at time zone 'UTC')
    and s.created_at_utc <= (aggregate_geo.date_to::timestamp at time zone 'UTC' + interval '1 day' - interval '1 second')
  group by 1
  order by sessions desc;
end;
$$;

-----------------------------------------------------------------------
-- 5. aggregate_entity_funnel: Entity aggregation for intelligence layer
--    Used by both mismatch detection and budget advisor
-----------------------------------------------------------------------
create or replace function public.aggregate_entity_funnel(
  date_from date,
  date_to date
)
returns table (
  entity_id text,
  entity_level text,
  spend numeric,
  visits bigint,
  chats bigint,
  reveals bigint,
  click_throughs bigint
)
language sql stable
as $$
  select
    d.entity_id,
    d.entity_level,
    coalesce(sum(d.spend), 0)::numeric as spend,
    coalesce(sum(d.visits), 0)::bigint as visits,
    coalesce(sum(d.chats), 0)::bigint as chats,
    coalesce(sum(d.reveals), 0)::bigint as reveals,
    coalesce(sum(d.click_throughs), 0)::bigint as click_throughs
  from public.daily_combined_stats d
  where d.entity_level = 'ad'
    and d.report_date >= date_from
    and d.report_date <= date_to
  group by d.entity_id, d.entity_level;
$$;
