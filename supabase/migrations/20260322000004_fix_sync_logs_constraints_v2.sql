-- Drop ALL check constraints on sync_logs and re-create with correct values
-- Using DO block to find and drop constraints by their auto-generated names

do $$
declare
  r record;
begin
  for r in (
    select conname
    from pg_constraint
    where conrelid = 'public.sync_logs'::regclass
      and contype = 'c'
  ) loop
    execute 'alter table public.sync_logs drop constraint ' || r.conname;
  end loop;
end $$;

-- Re-add constraints with all valid values
alter table public.sync_logs add constraint sync_logs_source_check
  check (source in ('meta', 'ghstly', 'combined', 'system'));

alter table public.sync_logs add constraint sync_logs_stage_check
  check (stage in ('orchestrate', 'fetch', 'persist', 'derive', 'daily_stats', 'sessions', 'stats_summaries', 'transcript_access', 'transcript_refresh'));

alter table public.sync_logs add constraint sync_logs_status_check
  check (status in ('running', 'success', 'failed', 'skipped', 'error'));

-- sync_type is nullable, so allow NULL + all known values
alter table public.sync_logs add constraint sync_logs_sync_type_check
  check (sync_type is null or sync_type in ('scheduled', 'manual', 'backfill', 'replay', 'incremental'));
