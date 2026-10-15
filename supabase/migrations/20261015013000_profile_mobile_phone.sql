-- Run before deploying the profile form update.
begin;
alter table public.profiles add column if not exists mobile_phone text;

-- Preserve numbers entered by the previous metadata-based form.
update public.profiles as p
set mobile_phone = nullif(btrim(u.raw_user_meta_data ->> 'mobile_phone'), '')
from auth.users as u
where p.id = u.id
  and p.mobile_phone is null
  and jsonb_typeof(u.raw_user_meta_data -> 'mobile_phone') = 'string';

-- Mobile numbers are personal profile data; the example's public SELECT
-- policy must not expose them to anonymous visitors or other users.
drop policy if exists "Public profiles are viewable by everyone." on public.profiles;
drop policy if exists "Users can view their own profile." on public.profiles;
create policy "Users can view their own profile." on public.profiles
  for select to authenticated using (auth.uid() = id);

notify pgrst, 'reload schema';
commit;
