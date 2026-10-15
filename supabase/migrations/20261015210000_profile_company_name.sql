-- Run before deploying the profile form update.
begin;
alter table public.profiles add column if not exists company_name text
  check (company_name is null or char_length(company_name) <= 120);
notify pgrst, 'reload schema';
commit;
