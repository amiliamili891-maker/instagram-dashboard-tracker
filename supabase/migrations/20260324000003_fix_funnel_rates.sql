-- Fix funnel rate calculations to match Ghstly partner dashboard definitions:
-- 1. reveal_click_through_rate: click_throughs / chats (was click_throughs / reveals)
-- 2. Add conversion_rate: ghstly_conversions / chats (was missing entirely)

-- Add conversion_rate column to daily_combined_stats
alter table public.daily_combined_stats
  add column if not exists conversion_rate numeric(8, 6);

-- Update aggregate_kpis RPC to fix reveal_click_through_rate denominator and add conversion_rate
drop function if exists public.aggregate_kpis(date, date);

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
  ghstly_conversions bigint,
  chat_rate numeric,
  cost_per_chat numeric,
  reveal_rate numeric,
  cost_per_reveal numeric,
  ctr numeric,
  cpc numeric,
  cpm numeric,
  cost_per_unique_click numeric,
  reveal_click_through_rate numeric,
  conversion_rate numeric
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
    coalesce(sum(d.ghstly_conversions), 0)::bigint as ghstly_conversions,
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
    -- FIXED: denominator is chats (not reveals) — matches Ghstly partner dashboard
    case when coalesce(sum(d.chats), 0) = 0 then null
         else sum(d.click_throughs)::numeric / sum(d.chats)
    end as reveal_click_through_rate,
    -- NEW: conversion_rate = conversions / chats
    case when coalesce(sum(d.chats), 0) = 0 then null
         else sum(d.ghstly_conversions)::numeric / sum(d.chats)
    end as conversion_rate
  from public.daily_combined_stats d
  where d.entity_level = 'ad'
    and d.report_date >= date_from
    and d.report_date <= date_to;
$$;

-- Update aggregate_trends RPC to fix reveal_click_through_rate and add conversion_rate
drop function if exists public.aggregate_trends(date, date, text);

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
      -- rate/derived metrics
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
        -- FIXED: denominator is chats (not reveals)
        case when coalesce(sum(d.chats), 0) = 0 then null
             else sum(d.click_throughs)::numeric / sum(d.chats)
        end
      when 'conversion_rate' then
        case when coalesce(sum(d.chats), 0) = 0 then null
             else sum(d.ghstly_conversions)::numeric / sum(d.chats)
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
