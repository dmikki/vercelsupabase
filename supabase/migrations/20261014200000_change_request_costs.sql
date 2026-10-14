begin;
alter table public.change_requests add column if not exists estimate jsonb;
alter table public.change_requests add column if not exists auto_authorized boolean not null default false;
create table if not exists public.development_spending_policy (
  id integer primary key check (id=1),
  auto_approve_usd numeric(6,2) not null default 0 check (auto_approve_usd between 0 and 100)
);
insert into public.development_spending_policy(id,auto_approve_usd) values(1,0) on conflict(id) do nothing;
alter table public.development_spending_policy enable row level security;
revoke all on public.development_spending_policy from anon, authenticated;
grant select, update on public.development_spending_policy to service_role;
commit;
