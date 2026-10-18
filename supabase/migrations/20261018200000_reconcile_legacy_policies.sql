-- Production was set up by hand and kept policies under names the earlier migrations never dropped.
-- Policies are permissive, so the leftover public SELECT exposed every profile (including phone numbers)
-- to anonymous visitors even after "Public profiles are viewable by everyone." was removed.
begin;
drop policy if exists "Public profiles are viewable by everyone" on public.profiles;
drop policy if exists "Users can insert their own profile" on public.profiles;
drop policy if exists "Users can update their own profile" on public.profiles;

drop policy if exists "Signed-in users can upload their own avatars" on storage.objects;
drop policy if exists "Users can update their own avatars" on storage.objects;
drop policy if exists "Avatar images are publicly accessible." on storage.objects;
drop policy if exists "Signed-in users can view avatars" on storage.objects;
create policy "Signed-in users can view avatars" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars');

notify pgrst, 'reload schema';
commit;
