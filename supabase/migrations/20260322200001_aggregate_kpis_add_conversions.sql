-- Add ghstly_conversions to aggregate_kpis RPC
-- Needed for Conversions and Estimated ROA KPI cards
-- Must DROP first because return type is changing (Postgres limitation)

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
    case when coalesce(sum(d.reveals), 0) = 0 then null
         else sum(d.click_throughs)::numeric / sum(d.reveals)
    end as reveal_click_through_rate
  from public.daily_combined_stats d
  where d.entity_level = 'ad'
    and d.report_date >= date_from
    and d.report_date <= date_to;
$$;
