-- Fix intelligence_alerts schema mismatches:
-- 1. alert_type CHECK constraint missing 'health' and 'kill_rule'
-- 2. Missing 'title' column (code writes it, schema doesn't have it)
-- 3. Missing 'metadata' column (code writes it, schema has 'data' instead)
-- 4. sync_batch_id is NOT NULL but intelligence pass doesn't provide it
-- 5. Add unique constraint for upsert on (entity_id, entity_type, alert_type)

-- Fix alert_type constraint
alter table public.intelligence_alerts
  drop constraint if exists intelligence_alerts_alert_type_check;

alter table public.intelligence_alerts
  add constraint intelligence_alerts_alert_type_check
  check (alert_type in ('threshold', 'anomaly', 'budget', 'mismatch', 'data_quality', 'health', 'kill_rule'));

-- Add missing columns
alter table public.intelligence_alerts
  add column if not exists title text;

alter table public.intelligence_alerts
  add column if not exists metadata jsonb;

-- Make sync_batch_id nullable (intelligence pass doesn't have a batch ID)
alter table public.intelligence_alerts
  alter column sync_batch_id drop not null;

-- Add unique constraint for upsert conflict resolution
create unique index if not exists intelligence_alerts_entity_type_key
  on public.intelligence_alerts (entity_id, entity_type, alert_type);
