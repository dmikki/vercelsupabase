-- Data that exists before the release under test; verify-legacy-data.sql proves it survives.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'legacy@example.test', '', now(), '{"full_name":"Legacy User"}', now(), now());
insert into public.change_requests (id, user_id, title, description)
values ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a1',
  'Legacy request', 'A request that already existed before this release was applied.');
