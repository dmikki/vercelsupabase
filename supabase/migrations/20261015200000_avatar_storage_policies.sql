-- Avatars are uploaded to a folder named after the uploader's user ID.
-- Existing avatars at the old top-level paths stay readable through the unchanged select policy.
begin;
drop policy if exists "Anyone can upload an avatar." on storage.objects;
drop policy if exists "Anyone can update their own avatar." on storage.objects;

create policy "Users upload avatars to their own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.jwt()->>'sub'));

create policy "Users update their own avatars" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and owner_id = (select auth.jwt()->>'sub'))
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.jwt()->>'sub'));

create policy "Users delete their own avatars" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and owner_id = (select auth.jwt()->>'sub'));

update storage.buckets
  set file_size_limit = 2097152, allowed_mime_types = array['image/png','image/jpeg','image/webp','image/gif']
  where id = 'avatars';
commit;
