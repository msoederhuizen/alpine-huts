-- Storage for photos people send in.
--
-- ⚠️ THE BUCKET IS PRIVATE AND STAYS PRIVATE. A public bucket would serve every
-- upload the instant it arrived, which is the one thing moderating before
-- publication is meant to prevent — the row would say 'pending' while the
-- image itself sat on a guessable URL. Approved photos are handed out as
-- short-lived signed URLs instead, minted only for rows the policies already
-- allow the caller to read.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'hut-photos',
  'hut-photos',
  false,
  8388608,                                     -- 8 MB; phone photos are ~2-4 MB
  array['image/jpeg','image/png','image/webp','image/heic']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Each person writes only inside their own folder, named by their user id.
-- ⚠️ The path prefix is the ONLY thing separating one person's uploads from
-- another's, so the app must build it from the awaited user id and never from
-- anything a caller supplies.
create policy upload_own_folder on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'hut-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy read_own_uploads on storage.objects
  for select to authenticated
  using (
    bucket_id = 'hut-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy delete_own_uploads on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'hut-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ⚠️ NO PUBLIC READ POLICY, DELIBERATELY. Approved images are served through
-- signed URLs created by the app after it has read an approved row, so the
-- table's policies stay the single gate. Adding "anyone may read this bucket"
-- would quietly make every pending upload world-readable.
