begin;
alter table public.change_requests add column if not exists authorization_fingerprint text;
alter table public.change_requests add column if not exists kind text not null default 'change' check(kind in ('change','suggestion'));
create table public.change_request_attachments (
 id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
 draft_id uuid not null, request_id uuid references public.change_requests(id) on delete cascade,
 name text not null, mime text not null, size integer not null check(size>0 and size<=2097152),
 sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),storage_path text not null unique,
 ready boolean not null default false,removed boolean not null default false,created_at timestamptz not null default now()
);
create index on public.change_request_attachments(user_id,draft_id);
create index on public.change_request_attachments(request_id);
alter table public.change_request_attachments enable row level security;
revoke all on public.change_request_attachments from anon,authenticated;
grant select on public.change_request_attachments to authenticated;
grant all on public.change_request_attachments to service_role;
create policy "Read own request attachments" on public.change_request_attachments for select to authenticated using(user_id=(select auth.uid()));
create function public.reserve_change_attachment(attachment_id uuid,actor uuid,draft_id uuid,file_name text,file_mime text,file_size integer,file_path text,file_hash text)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(actor::text,1));
 if (select count(*) from public.change_request_attachments a where a.user_id=actor and a.draft_id=reserve_change_attachment.draft_id and not a.removed)>=5 then raise exception 'Draft attachment limit';end if;
 if (select count(*) from public.change_request_attachments a where a.user_id=actor and a.created_at>now()-interval '1 day')>=25 then raise exception 'Daily attachment limit';end if;
 insert into public.change_request_attachments(id,user_id,draft_id,name,mime,size,storage_path,sha256) values(attachment_id,actor,draft_id,file_name,file_mime,file_size,file_path,file_hash);
end;$$;
revoke all on function public.reserve_change_attachment(uuid,uuid,uuid,text,text,integer,text,text) from public,anon,authenticated;
grant execute on function public.reserve_change_attachment(uuid,uuid,uuid,text,text,integer,text,text) to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('change-request-attachments','change-request-attachments',false,2097152,array['image/png','image/jpeg','image/webp','text/plain','text/markdown','text/csv','application/json']) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
commit;
