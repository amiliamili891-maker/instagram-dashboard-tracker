-- Add full-size creative image columns to ads table
alter table public.ads
  add column if not exists creative_image_url text;

alter table public.ads
  add column if not exists creative_full_path text;
