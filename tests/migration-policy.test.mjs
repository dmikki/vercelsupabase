import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { migrationViolations, validateMigrationChanges, parsePendingMigrations, unexpectedPending, tokenizeSql } from '../scripts/development/migration-policy.mjs'
import { inspectMigrations } from '../scripts/development/migration-tools.mjs'
import { allowedPath } from '../scripts/development/policy.mjs'

const good = `
begin;
-- A private notes table.
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null default '',
  created_at timestamptz not null default now()
);
create index notes_user_idx on public.notes(user_id);
alter table public.notes enable row level security;
revoke all on public.notes from anon, authenticated;
grant select, insert, update, delete on public.notes to authenticated;
grant all on public.notes to service_role;
create policy "Users read own notes" on public.notes for select to authenticated using (user_id = (select auth.uid()));
create policy "Users write own notes" on public.notes for insert to authenticated with check (user_id = (select auth.uid()));
alter table public.profiles add column if not exists nickname text;
alter table public.profiles add column if not exists theme text not null default 'light';
create function public.note_count() returns bigint language sql security definer set search_path = '' as $$
  select count(*) from public.notes where user_id = (select auth.uid());
$$;
grant execute on function public.note_count() to authenticated;
commit;`

const bad = {
  'drops a table': 'drop table public.profiles;',
  'drops a column': 'alter table public.profiles drop column full_name;',
  'renames a column': 'alter table public.profiles rename column full_name to name;',
  'retypes a column': 'alter table public.profiles alter column website type integer using 1;',
  'sets not null': 'alter table public.profiles alter column website set not null;',
  'adds a NOT NULL column without default': 'alter table public.profiles add column age integer not null;',
  'updates rows': "update public.profiles set full_name = 'x';",
  'deletes rows': 'delete from public.profiles;',
  'truncates': 'truncate public.profiles;',
  'creates a table without RLS': 'create table public.open_notes (id uuid primary key);',
  'disables RLS': 'alter table public.profiles disable row level security;',
  'unrestricted policy': 'create policy "x" on public.profiles for select to authenticated using (true);',
  'policy without roles': 'create policy "x" on public.profiles for select using ((select auth.uid()) = id);',
  'policy for anon': 'create policy "x" on public.profiles for select to anon using ((select auth.uid()) = id);',
  'grant to anon': 'grant select on public.profiles to anon;',
  'grant to public': 'grant select on public.profiles to public;',
  'grant all to authenticated': 'grant all on public.profiles to authenticated;',
  'blanket schema grant': 'grant select on all tables in schema public to authenticated;',
  'security definer without search_path': "create function public.f() returns int language sql security definer as $$ select 1 $$;",
  'untrusted language': "create function public.f() returns int language plpython3u as $$ return 1 $$;",
  'view without security_invoker': 'create view public.v as select id from public.profiles;',
  'extension': 'create extension pg_cron;',
  'auth table change': 'alter table auth.users add column x text;',
  'auth trigger': 'create trigger t after insert on auth.users for each row execute function public.handle_new_user();',
  'storage delete': "delete from storage.objects where bucket_id = 'x';",
  'function reads auth.users': "create function public.f() returns int language sql set search_path = '' as $$ select count(*)::int from auth.users $$;",
  'function with dynamic sql': "create function public.f() returns void language plpgsql set search_path = '' as $$ begin execute format('drop table %I', 'x'); end $$;",
  'DO block': "do $$ begin perform 1; end $$;",
  'plain select': "select pg_sleep(1);",
  'role change': 'alter role postgres with superuser;',
  'set role': 'set role postgres;',
  'create schema': 'create schema private;',
  'object in other schema': 'create table private.x (id int);',
}

test('additive migrations are accepted, including comments, quoted names and dollar bodies', () => {
  assert.deepEqual(migrationViolations(good), [])
})

test('the repository migrations written after the baseline satisfy the policy except known manual-only operations', () => {
  const clean = ['20261014180000_change_requests.sql', '20261014200000_change_request_costs.sql', '20261014203000_request_attachments.sql', '20261015210000_profile_company_name.sql', '20261015220000_profile_policy_hardening.sql']
  for (const name of clean) assert.deepEqual(migrationViolations(readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')), [], name)
  assert.notDeepEqual(migrationViolations(readFileSync(new URL('../supabase/migrations/20221017024722_init.sql', import.meta.url), 'utf8')), [])
})

for (const [name, sql] of Object.entries(bad)) {
  test(`rejects a migration that ${name}`, () => assert.notDeepEqual(migrationViolations(`begin; ${sql}; commit;`), [], name))
}

test('forbidden words inside strings and comments do not trigger violations', () => {
  const sql = "create table public.logs (id uuid primary key, note text default 'drop table; delete from x');\n-- delete from auth.users;\nalter table public.logs enable row level security;"
  assert.deepEqual(migrationViolations(sql), [])
  assert.equal(tokenizeSql("select 'a;b'; select 2").statements.length, 2)
})

test('new migrations must be sequential, uniquely versioned, named correctly, and few', () => {
  const existing = ['supabase/migrations/20261015220000_profile_policy_hardening.sql']
  const file = (path, sql = good) => ({ path, sql })
  assert.deepEqual(validateMigrationChanges([file('supabase/migrations/20261016000000_add_notes.sql')], existing), [])
  assert.match(validateMigrationChanges([file('supabase/migrations/20261001000000_old.sql')], existing)[0], /newer than the latest/)
  assert.match(validateMigrationChanges([file('supabase/migrations/notes.sql')], existing)[0], /14-digit/)
  assert.match(validateMigrationChanges([file('supabase/migrations/20261016000000_a_b.sql'), file('supabase/migrations/20261016000000_a_c.sql')], existing).join(), /duplicate/)
  const many = [1, 2, 3, 4].map(n => file(`supabase/migrations/2026101600000${n}_note_${n}.sql`))
  assert.match(validateMigrationChanges(many, existing)[0], /more than 3/)
})

test('migration files are allowed paths only with the exact timestamped name', () => {
  assert.equal(allowedPath('supabase/migrations/20261016000000_add_notes.sql'), true)
  for (const path of ['supabase/migrations/add_notes.sql', 'supabase/migrations/20261016000000_Add.sql', 'supabase/config.toml', 'supabase/migrations/../config.toml', 'supabase/migrations/20261016000000_add_notes.sql.bak']) assert.equal(allowedPath(path), false, path)
})

test('only migrations listed for this release may be pending in a database', () => {
  const output = 'DRY RUN: migrations will *not* be pushed to the database.\nWould push these migrations:\n • 20221017024722_init.sql\n • 20261016000000_add_notes.sql\n'
  assert.deepEqual(parsePendingMigrations(output), ['20221017024722_init.sql', '20261016000000_add_notes.sql'])
  assert.deepEqual(unexpectedPending(parsePendingMigrations(output), ['supabase/migrations/20261016000000_add_notes.sql']), ['20221017024722_init.sql'])
  const agent = ' • 20261016000000_add_notes.sql\n{"migrations":["20261016000000_add_notes.sql"]}'
  assert.deepEqual(parsePendingMigrations(agent), ['20261016000000_add_notes.sql'])
  assert.deepEqual(unexpectedPending(parsePendingMigrations('Remote database is up to date.'), []), [])
})

test('inspecting a change set treats edits and deletions of existing migrations as violations', () => {
  const files = { 'supabase/migrations/20261016000000_add_notes.sql': good }
  const run = args => args[0] === 'ls-files' ? '' : args[0] === 'diff'
    ? 'A\tsupabase/migrations/20261016000000_add_notes.sql\nM\tsupabase/migrations/20261014180000_change_requests.sql\nD\tsupabase/migrations/20261014200000_change_request_costs.sql\n'
    : 'supabase/migrations/20261014180000_change_requests.sql\nsupabase/migrations/20261014200000_change_request_costs.sql\n'
  const result = inspectMigrations('base', path => files[path], run)
  assert.deepEqual(result.added, ['supabase/migrations/20261016000000_add_notes.sql'])
  assert.equal(result.problems.filter(problem => problem.includes('immutable')).length, 2)
})
