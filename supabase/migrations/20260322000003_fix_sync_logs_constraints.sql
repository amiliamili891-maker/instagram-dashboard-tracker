-- Fix sync_logs stage constraint to allow Ghstly sync stages
alter table public.sync_logs drop constraint if exists sync_logs_stage_check;
alter table public.sync_logs add constraint sync_logs_stage_check
  check (stage in ('orchestrate', 'fetch', 'persist', 'derive', 'daily_stats', 'sessions', 'stats_summaries', 'transcript_access', 'transcript_refresh'));

-- Fix sync_logs sync_type constraint to allow 'incremental'
alter table public.sync_logs drop constraint if exists sync_logs_sync_type_check;
-- Remove the old check constraint on sync_type (added in schema_additions)
do $$
begin
  -- Drop any check constraint on sync_type column
  execute (
    select 'alter table public.sync_logs drop constraint ' || conname
    from pg_constraint
    where conrelid = 'public.sync_logs'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%sync_type%'
    limit 1
  );
exception when others then
  null; -- No constraint to drop
end $$;

alter table public.sync_logs add constraint sync_logs_sync_type_check
  check (sync_type in ('scheduled', 'manual', 'backfill', 'replay', 'incremental'));

-- Fix sync_logs status constraint to include 'error' (used by ghstly-sync)
alter table public.sync_logs drop constraint if exists sync_logs_status_check;
alter table public.sync_logs add constraint sync_logs_status_check
  check (status in ('running', 'success', 'failed', 'skipped', 'error'));

-- Fix sync_logs source constraint to include all sources
alter table public.sync_logs drop constraint if exists sync_logs_source_check;
alter table public.sync_logs add constraint sync_logs_source_check
  check (source in ('meta', 'ghstly', 'combined', 'system'));
