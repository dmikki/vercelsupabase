import { execFileSync } from 'node:child_process'
import { readFileSync, appendFileSync } from 'node:fs'
import { migrationPath, parsePendingMigrations, unexpectedPending, validateMigrationChanges } from './migration-policy.mjs'

const git = args => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 20_000_000 })

// Compares the working tree with `base` and validates every migration change.
export function inspectMigrations(base, read = path => readFileSync(path, 'utf8'), run = git) {
  const changes = run(['diff', '--name-status', '--no-renames', base, '--', 'supabase/migrations'])
    .split('\n').filter(Boolean).map(line => line.split('\t'))
  const existing = run(['ls-tree', '-r', '--name-only', base, 'supabase/migrations']).split('\n').filter(Boolean)
  const untracked = run(['ls-files', '--others', '--exclude-standard', 'supabase/migrations']).split('\n').filter(Boolean).map(path => ['A', path])
  const added = []
  const problems = []
  for (const [status, path] of [...changes, ...untracked]) {
    if (status === 'A') added.push({ path, sql: migrationPath(path) ? read(path) : '' })
    else problems.push(`${path}: existing migrations are immutable; add a new migration instead (${status})`)
  }
  problems.push(...validateMigrationChanges(added, existing))
  return { added: added.map(file => file.path), problems }
}

function setOutputs(values) {
  if (!process.env.GITHUB_OUTPUT) return
  appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''))
}

function main(argv) {
  const [command, ...args] = argv
  if (command === 'check') {
    const base = args[0] || process.env.BASE_SHA
    if (!base) throw new Error('check needs a base ref')
    const { added, problems } = inspectMigrations(base)
    setOutputs({ count: added.length, files: added.join(',') })
    console.log(JSON.stringify({ added, problems }, null, 2))
    if (problems.length) { console.error(`Migration policy failed:\n- ${problems.join('\n- ')}`); process.exitCode = 1 }
  } else if (command === 'guard') {
    const [dryRunFile, expected = ''] = args
    const pending = parsePendingMigrations(readFileSync(dryRunFile, 'utf8'))
    const unexpected = unexpectedPending(pending, expected.split(',').filter(Boolean))
    console.log(JSON.stringify({ pending, unexpected }))
    if (unexpected.length) {
      console.error(`Refusing to apply: ${unexpected.join(', ')} would also run. The target migration history is out of sync with main; run the baseline workflow or repair the history first.`)
      process.exitCode = 1
    }
  } else throw new Error('Usage: migration-tools.mjs check [base] | guard <dry-run-output> <comma-separated expected files>')
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2))
