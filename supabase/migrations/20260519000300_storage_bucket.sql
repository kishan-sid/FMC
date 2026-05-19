-- =====================================================================
--  Storage bucket for generated exports (.xlsx / .csv)
--  Path scheme:  exports/<user_id>/<filename>
--  Private bucket — files served via signed URLs from the
--  export-signed-url edge function.
-- =====================================================================

set role postgres;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'exports',
  'exports',
  false,
  52428800, -- 50 MB
  array[
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'application/octet-stream'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------
-- Bucket RLS — owner can read/write/delete only their own folder
-- ---------------------------------------------------------------------
drop policy if exists "exports owner select"  on storage.objects;
create policy "exports owner select" on storage.objects
  for select using (
    bucket_id = 'exports'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "exports owner insert"  on storage.objects;
create policy "exports owner insert" on storage.objects
  for insert with check (
    bucket_id = 'exports'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "exports owner update"  on storage.objects;
create policy "exports owner update" on storage.objects
  for update using (
    bucket_id = 'exports'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "exports owner delete"  on storage.objects;
create policy "exports owner delete" on storage.objects
  for delete using (
    bucket_id = 'exports'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
