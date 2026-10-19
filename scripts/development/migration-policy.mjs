// Automated (model-written) migrations must be additive so the code already in production keeps
// working while the schema is expanded before the new release is merged. Anything this policy
// cannot prove safe is rejected and stays a manual engineering change.

export const MIGRATION_PATH = /^supabase\/migrations\/(\d{14})_[a-z0-9_]{3,60}\.sql$/
export const MAX_MIGRATIONS_PER_REQUEST = 3
export const MAX_MIGRATION_BYTES = 60_000

export function migrationPath(path) {
  return MIGRATION_PATH.test(path)
}

export function migrationVersion(path) {
  return MIGRATION_PATH.exec(path)?.[1] || null
}

// Removes comments, replaces string literals, and splits into statements. Dollar-quoted bodies are
// returned separately because they are executable code, not data.
export function tokenizeSql(sql) {
  const statements = []
  const bodies = []
  let current = ''
  let i = 0
  const push = () => {
    const text = current.replace(/\s+/g, ' ').trim().toLowerCase()
    if (text) statements.push(text)
    current = ''
  }
  while (i < sql.length) {
    const ch = sql[i]
    const next = sql[i + 1]
    if (ch === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i++
      current += ' '
    } else if (ch === '/' && next === '*') {
      let depth = 1
      i += 2
      while (i < sql.length && depth) {
        if (sql[i] === '/' && sql[i + 1] === '*') { depth++; i += 2 }
        else if (sql[i] === '*' && sql[i + 1] === '/') { depth--; i += 2 }
        else i++
      }
      current += ' '
    } else if (ch === "'") {
      const escaped = /[eE]$/.test(current) && !/[\w$]e$/i.test(current)
      i++
      while (i < sql.length) {
        if (escaped && sql[i] === '\\') { i += 2; continue }
        if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue }
        if (sql[i] === "'") { i++; break }
        i++
      }
      current += "''"
    } else if (ch === '"') {
      let end = sql.indexOf('"', i + 1)
      if (end < 0) end = sql.length
      const name = sql.slice(i + 1, end)
      current += /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : 'qident'
      i = end + 1
    } else if (ch === '$') {
      const tag = /^\$[A-Za-z_]*[A-Za-z0-9_]*\$/.exec(sql.slice(i))?.[0]
      if (tag && !/[\w]$/.test(current)) {
        const end = sql.indexOf(tag, i + tag.length)
        const stop = end < 0 ? sql.length : end
        bodies.push(sql.slice(i + tag.length, stop))
        current += ' $body$ '
        i = end < 0 ? sql.length : end + tag.length
      } else { current += ch; i++ }
    } else if (ch === ';') {
      push(); i++
    } else { current += ch; i++ }
  }
  push()
  return { statements, bodies }
}

function splitTopLevel(text, separator = ',') {
  const parts = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')') depth--
    else if (text[i] === separator && depth === 0) { parts.push(text.slice(start, i).trim()); start = i + 1 }
  }
  parts.push(text.slice(start).trim())
  return parts
}

const publicName = name => !name.includes('.') || name.startsWith('public.')
const tableName = name => (name.includes('.') ? name : `public.${name}`)
const ALLOWED_ROLES = new Set(['authenticated', 'service_role'])
const PROTECTED_REFERENCE = /\b(auth|vault|supabase_migrations|pg_catalog|information_schema|pg_temp|extensions|realtime|cron|net)\.(\w+)/g
const SAFE_AUTH_FUNCTIONS = new Set(['uid', 'jwt', 'role', 'email'])
const SAFE_STORAGE_FUNCTIONS = new Set(['foldername', 'filename', 'extension'])

function checkCreate(s, violations, created) {
  const kind = /^create (?:or replace )?(?:(unique) )?(table|index|function|view|trigger|policy|type|sequence)\b/.exec(s)
  if (!kind) return violations.push(`unsupported CREATE statement: ${s.slice(0, 60)}`)
  const type = kind[2]
  if (type === 'table') {
    const name = /^create table (?:if not exists )?([\w.]+)/.exec(s)?.[1]
    if (!name || !publicName(name)) return violations.push('tables must be created in the public schema')
    created.push(tableName(name))
  } else if (type === 'function') {
    const name = /^create (?:or replace )?function ([\w.]+)/.exec(s)?.[1]
    if (!name || !publicName(name)) violations.push('functions must be created in the public schema')
    if (!/\blanguage (plpgsql|sql)\b/.test(s)) violations.push('functions must be plpgsql or sql')
    if (/\bsecurity definer\b/.test(s) && !/\bset search_path\b/.test(s)) violations.push('security definer functions must set search_path')
  } else if (type === 'view') {
    const name = /^create (?:or replace )?view ([\w.]+)/.exec(s)?.[1]
    if (!name || !publicName(name)) violations.push('views must be created in the public schema')
    if (!/security_invoker\s*=\s*(true|on|1)\b/.test(s)) violations.push('views must use security_invoker = true so row-level security applies')
  } else if (type === 'trigger') {
    const table = /\bon\s+(?:only\s+)?([\w.]+)/.exec(s)?.[1]
    if (!table || !publicName(table)) violations.push('triggers may only be created on public tables')
  } else if (type === 'policy') {
    const match = /^create policy \S+ on ([\w.]+)(.*)$/.exec(s)
    if (!match) return violations.push('unreadable policy statement')
    const [, table, rest] = match
    if (!publicName(table) && table !== 'storage.objects') violations.push('policies may only target public tables or storage.objects')
    const roles = /^(?: as (?:permissive|restrictive))?(?: for (?:all|select|insert|update|delete))? to ([\w, ]+?)(?: using| with check|$)/.exec(rest)?.[1]
    if (!roles || !roles.split(',').map(role => role.trim()).every(role => ALLOWED_ROLES.has(role))) violations.push('policies must name only the authenticated or service_role roles')
    if (/\b(using|with check)\s*\(\s*true\s*\)/.test(rest)) violations.push('policies must not grant unrestricted access')
  } else if (type === 'index' && kind[1] === undefined && /\bon ([\w.]+)/.test(s)) {
    const table = /\bon (?:only )?([\w.]+)/.exec(s)[1]
    if (!publicName(table)) violations.push('indexes may only target public tables')
  }
}

function checkAlter(s, violations) {
  const target = /^alter (table|function|index|sequence) (?:if exists )?(?:only )?([\w.]+)/.exec(s)
  if (!target) return violations.push(`unsupported ALTER statement: ${s.slice(0, 60)}`)
  if (!publicName(target[2])) violations.push('ALTER may only target public objects')
  if (/\b(rename|set schema|owner to)\b/.test(s)) violations.push('renaming, moving, or changing owners is destructive')
  if (target[1] !== 'table') {
    if (target[1] === 'function' && /\bsecurity definer\b/.test(s)) violations.push('security definer must be set when the function is created')
    return
  }
  if (/\b(disable|no force) row level security\b/.test(s)) violations.push('row-level security cannot be disabled')
  if (/\bdisable trigger\b/.test(s)) violations.push('triggers cannot be disabled')
  const actions = splitTopLevel(s.replace(/^alter table (?:if exists )?(?:only )?[\w.]+\s*/, ''))
  for (const action of actions) {
    if (/^drop (column|constraint)\b/.test(action)) violations.push('dropping columns or constraints is destructive')
    if (/^alter (?:column )?\S+ (?:set data )?type\b/.test(action)) violations.push('changing column types is destructive')
    if (/^alter (?:column )?\S+ set not null\b/.test(action)) violations.push('SET NOT NULL can fail or break existing writers')
    if (/^add (?:column )?(?:if not exists )?\S+ /.test(action) && !/^add (constraint|primary|unique|foreign|check|exclude)/.test(action)
      && /\bnot null\b/.test(action) && !/\b(default|generated)\b/.test(action)) violations.push('new NOT NULL columns need a default so existing code and rows keep working')
  }
}

function checkGrant(s, violations) {
  if (!/^grant .+ on .+ to .+$/.test(s)) return violations.push('only object privilege grants are permitted')
  const roles = s.replace(/\s+with grant option$/, '').split(/\sto\s/).pop().split(',').map(role => role.trim())
  if (!roles.every(role => ALLOWED_ROLES.has(role))) violations.push('privileges may only be granted to authenticated or service_role')
  if (/\bwith grant option\b/.test(s)) violations.push('WITH GRANT OPTION is not permitted')
  if (/\ball (tables|functions|sequences) in schema\b/.test(s)) violations.push('blanket schema grants are not permitted')
  const privileges = s.replace(/^grant /, '').split(/\son\s/)[0]
  if (roles.includes('authenticated') && /\b(all|truncate|references|trigger)\b/.test(privileges)) violations.push('authenticated may only receive select, insert, update, delete, execute, or usage')
}

export function migrationViolations(sql) {
  const violations = []
  if (Buffer.byteLength(sql) > MAX_MIGRATION_BYTES) return ['migration is larger than the automated limit']
  const { statements, bodies } = tokenizeSql(sql)
  if (!statements.length) return ['migration is empty']
  const created = []
  const rowSecurity = new Set()
  for (const s of statements) {
    const first = s.split(' ')[0]
    if (['begin', 'commit'].includes(first)) continue
    if (first === 'create') checkCreate(s, violations, created)
    else if (first === 'alter') {
      checkAlter(s, violations)
      const table = /^alter table (?:if exists )?(?:only )?([\w.]+) enable row level security$/.exec(s)?.[1]
      if (table) rowSecurity.add(tableName(table))
    } else if (first === 'drop') {
      if (!/^drop (policy|trigger) (?:if exists )?\S+ on ([\w.]+)/.test(s) && !/^drop index (?:concurrently )?(?:if exists )?[\w.]+$/.test(s)) violations.push('only DROP POLICY, DROP TRIGGER, and DROP INDEX are permitted')
      const dropped = /^drop (?:policy|trigger) (?:if exists )?\S+ on ([\w.]+)/.exec(s)?.[1]
      if (dropped && !publicName(dropped) && dropped !== 'storage.objects') violations.push('policies and triggers may only be dropped from public tables or storage.objects')
    } else if (first === 'grant') checkGrant(s, violations)
    else if (first === 'revoke' || first === 'comment' || first === 'notify') continue
    else if (first === 'insert') {
      const table = /^insert into ([\w.]+)/.exec(s)?.[1]
      if (!table || (!publicName(table) && table !== 'storage.buckets')) violations.push('INSERT may only target public tables or storage.buckets')
    } else violations.push(`${first.toUpperCase()} statements are not permitted`)
    for (const match of s.matchAll(PROTECTED_REFERENCE)) {
      const [whole, schema, name] = match
      const before = s.slice(0, match.index)
      if (schema === 'auth' && (SAFE_AUTH_FUNCTIONS.has(name) || (name === 'users' && /\breferences\s*$/.test(before)))) continue
      violations.push(`references protected schema object ${whole}`)
    }
    for (const match of s.matchAll(/\bstorage\.(\w+)/g)) {
      if (!['objects', 'buckets', ...SAFE_STORAGE_FUNCTIONS].includes(match[1])) violations.push(`references protected schema object ${match[0]}`)
    }
  }
  for (const table of created) if (!rowSecurity.has(table)) violations.push(`${table} must enable row level security in the same migration`)
  for (const body of bodies) {
    const text = body.replace(/--[^\n]*/g, ' ').toLowerCase()
    for (const match of text.matchAll(PROTECTED_REFERENCE)) {
      if (match[1] === 'auth' && SAFE_AUTH_FUNCTIONS.has(match[2])) continue
      violations.push(`function body references protected schema object ${match[0]}`)
    }
    for (const match of text.matchAll(/\bstorage\.(\w+)/g)) if (!SAFE_STORAGE_FUNCTIONS.has(match[1])) violations.push(`function body references protected schema object ${match[0]}`)
    if (/\b(truncate|drop\s+(table|schema|column)|alter\s+(role|system)|set\s+(session\s+)?role|execute\s+(format|')|copy\s)/.test(text)) violations.push('function body contains destructive or dynamic SQL')
  }
  return [...new Set(violations)]
}

// `files` are the migrations added by the change; `existing` are the paths already on the base branch.
export function validateMigrationChanges(files, existing) {
  const problems = []
  if (files.length > MAX_MIGRATIONS_PER_REQUEST) problems.push(`more than ${MAX_MIGRATIONS_PER_REQUEST} migrations in one change`)
  const latest = existing.map(migrationVersion).filter(Boolean).sort().at(-1) || '0'
  const seen = new Set()
  for (const { path, sql } of files) {
    const version = migrationVersion(path)
    if (!version) { problems.push(`${path}: name must look like supabase/migrations/<14-digit UTC timestamp>_<snake_case>.sql`); continue }
    if (seen.has(version)) problems.push(`${path}: duplicate migration version`)
    seen.add(version)
    if (version <= latest) problems.push(`${path}: version must be newer than the latest existing migration ${latest}`)
    for (const reason of migrationViolations(sql)) problems.push(`${path}: ${reason}`)
  }
  return problems
}

// `supabase db push --dry-run` lists the migration files it would apply.
export function parsePendingMigrations(output) {
  return [...new Set([...output.matchAll(/(\d{14}_[A-Za-z0-9_]+\.sql)/g)].map(match => match[1]))]
}

export function unexpectedPending(pending, expected) {
  const allowed = new Set(expected.map(path => path.split('/').pop()))
  return pending.filter(name => !allowed.has(name))
}
