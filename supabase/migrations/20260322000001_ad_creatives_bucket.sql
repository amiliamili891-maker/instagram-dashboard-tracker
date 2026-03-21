-- Create private storage bucket for ad creative thumbnails
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ad-creatives',
  'ad-creatives',
  false,
  5242880,  -- 5MB max per file
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Authenticated users can read ad creatives (belt-and-suspenders; server uses service role)
create policy "Authenticated users can read ad creatives"
on storage.objects
for select
to authenticated
using (bucket_id = 'ad-creatives');
