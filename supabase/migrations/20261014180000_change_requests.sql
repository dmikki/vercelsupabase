create table public.change_requests (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 5 and 120),
  description text not null check (char_length(description) between 20 and 6000),
  status text not null default 'saved' check (status in ('saved','publishing','github_pending','submitted')),
  github_issue_number integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index change_requests_user_created_idx on public.change_requests(user_id, created_at desc);
alter table public.change_requests enable row level security;
revoke all on public.change_requests from anon, authenticated;
grant select on public.change_requests to authenticated;
grant all on public.change_requests to service_role;
create policy "Users read their own change requests" on public.change_requests
  for select to authenticated using (user_id = (select auth.uid()));

-- Only this narrow function can insert a request. Per-user locking makes the quota atomic.
create function public.submit_change_request(request_id uuid, request_title text, request_description text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); existing_actor uuid;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text, 0));
  select user_id into existing_actor from public.change_requests where id = request_id;
  if found then
    if existing_actor <> actor then raise exception 'Invalid request ID'; end if;
    return request_id;
  end if;
  if (select count(*) from public.change_requests where user_id = actor and created_at > now() - interval '1 day') >= 5
    then raise exception 'Daily request limit reached'; end if;
  insert into public.change_requests(id,user_id,title,description)
    values(request_id,actor,trim(request_title),trim(request_description));
  return request_id;
end; $$;
revoke all on function public.submit_change_request(uuid,text,text) from public;
grant execute on function public.submit_change_request(uuid,text,text) to authenticated;
