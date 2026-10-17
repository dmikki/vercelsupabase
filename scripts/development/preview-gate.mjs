import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { api, allPages } from './github.mjs'
import { PREVIEW_CHECK } from './release-state.mjs'
import { inspectMigrations } from './migration-tools.mjs'
import { migrationPath } from './migration-policy.mjs'
import { summarizeChecks, verifyDeployment } from './verify-deployment.mjs'

const STAGING_SECRETS = ['STAGING_DATABASE_URL', 'STAGING_SUPABASE_URL', 'STAGING_SUPABASE_PUBLISHABLE_KEY', 'STAGING_SUPABASE_SERVICE_ROLE_KEY']

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 50_000_000, ...options })
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim()
  return { ok: result.status === 0, output: output.slice(-4000) }
}

// Brings the staging database to "main plus this change" and proves the schema is healthy there.
// Trusted scripts and tests come from main; only the migration SQL comes from the pull request.
// Staging is shared and disposable: history entries left by abandoned pull requests are repaired away.
export function stageDatabase({ migrations, headSha, env = process.env, exec = run, wait = seconds => run('sleep', [String(seconds)]) }) {
  const missing = STAGING_SECRETS.filter(name => !env[name])
  if (missing.length) return { state: 'setup', log: `Missing staging secrets: ${missing.join(', ')}. See docs/development-automation.md, "One-time setup".` }
  const log = []
  const step = (name, result) => { log.push(`${result.ok ? 'PASS' : 'FAIL'} ${name}${result.ok ? '' : `\n${result.output}`}`); return result.ok }
  if (migrations.length) {
    if (!env.SKIP_MIGRATION_FETCH) {
      if (!step('Fetch migrations from the pull request', exec('git', ['fetch', '--depth=1', 'origin', headSha]))) return { state: 'failure', log: log.join('\n') }
      if (!step('Check out migrations', exec('git', ['checkout', headSha, '--', 'supabase/migrations']))) return { state: 'failure', log: log.join('\n') }
    }
    let problems = []
    try { problems = inspectMigrations('HEAD').problems } catch (error) { problems = [error.message] }
    log.push(problems.length ? `FAIL Migration policy\n${problems.join('\n')}` : 'PASS Migration policy')
    if (problems.length) return { state: 'failure', log: log.join('\n') }
  }
  const stagingEnv = { ...env, SUPABASE_URL: env.STAGING_SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY: env.STAGING_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY: env.STAGING_SUPABASE_SERVICE_ROLE_KEY }
  const push = () => exec('supabase', ['db', 'push', '--db-url', env.STAGING_DATABASE_URL, '--include-all', '--skip-vault'], { env })
  let pushed = { ok: false, output: '' }
  for (let attempt = 1; attempt <= 3 && !pushed.ok; attempt++) {
    // Concurrent pull requests share one staging database; retry briefly if another run holds the migration lock.
    if (attempt > 1) wait(30)
    pushed = push()
    const orphaned = /migration repair --status reverted((?: \d{14})+)/.exec(pushed.output)?.[1]?.trim().split(' ')
    if (!pushed.ok && orphaned) {
      log.push(`Repairing staging history left by abandoned pull requests: ${orphaned.join(', ')}`)
      if (exec('supabase', ['migration', 'repair', '--status', 'reverted', ...orphaned, '--db-url', env.STAGING_DATABASE_URL], { env }).ok) pushed = push()
    }
  }
  const ok = step('Bring staging up to date with main and this change', pushed)
    && step('Security invariants on staging', exec('psql', [env.STAGING_DATABASE_URL, '-v', 'ON_ERROR_STOP=1', '-f', 'integration/schema-invariants.sql'], { env }))
    && step('Integration tests on staging', exec('node', ['--test', 'integration/*.test.mjs'], { env: stagingEnv }))
  return { state: ok ? 'success' : 'failure', log: log.join('\n') }
}

export async function runGate({ migrations, headSha, previewUrl, env = process.env }) {
  const staging = stageDatabase({ migrations, headSha, env })
  const productionHost = (() => { try { return new URL(env.PRODUCTION_SUPABASE_URL || '').host } catch { return '' } })()
  const preview = await verifyDeployment({ baseUrl: previewUrl, expectedSha: headSha, expectedEnvironment: 'preview', productionHost, bypassSecret: env.VERCEL_AUTOMATION_BYPASS_SECRET || '' })
  const protectionBlocked = preview.checks[0]?.detail.includes('VERCEL_AUTOMATION_BYPASS_SECRET')
  const missingProduction = preview.checks.some(check => check.detail.includes('PRODUCTION_SUPABASE_URL'))
  const previewState = preview.ok ? 'success' : protectionBlocked || missingProduction ? 'setup' : 'failure'
  const gates = { staging: staging.state, preview: previewState, details: preview.checks }
  const success = ['success', 'skipped'].includes(staging.state) && preview.ok
  const text = `${staging.log}\n\n${summarizeChecks(preview.checks)}`
  return { success, gates, text }
}

async function findPreviewUrl(sha) {
  const deployments = await api(`/deployments?sha=${sha}&per_page=30`)
  for (const deployment of deployments.filter(item => /^preview/i.test(item.environment))) {
    const statuses = await api(`/deployments/${deployment.id}/statuses?per_page=10`)
    const done = statuses.find(status => status.state === 'success' && status.environment_url)
    if (done) return done.environment_url
  }
  return ''
}

async function resolveTarget(event) {
  let sha
  let url = ''
  let pr
  if (event.deployment_status) {
    if (event.deployment_status.state !== 'success' || !/^preview/i.test(event.deployment?.environment || '')) return null
    sha = event.deployment.sha
    url = event.deployment_status.environment_url || ''
    const open = (await api(`/commits/${sha}/pulls`)).filter(item => item.state === 'open' && item.head.sha === sha)
    pr = open[0]
  } else {
    pr = await api(`/pulls/${Number(process.env.PR_NUMBER)}`)
    sha = pr.head.sha
    url = await findPreviewUrl(sha)
    if (!url) throw new Error('No successful Vercel preview deployment exists for this commit yet.')
  }
  if (!pr || pr.base.ref !== 'main' || !pr.head.ref.startsWith('codex/request-') || pr.head.repo.full_name !== process.env.GITHUB_REPOSITORY) return null
  return { pr, sha, url }
}

async function main() {
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'))
  const target = await resolveTarget(event)
  if (!target) { console.log('No eligible pull request for this deployment; nothing to verify.'); return }
  const files = await allPages(`/pulls/${target.pr.number}/files`)
  const migrations = files.filter(file => file.status === 'added' && migrationPath(file.filename)).map(file => file.filename)
  console.log(`Verifying PR #${target.pr.number} at ${target.sha.slice(0, 7)} on ${target.url} (${migrations.length} migration(s))`)
  const result = await runGate({ migrations, headSha: target.sha, previewUrl: target.url })
  console.log(result.text)
  const anySetup = Object.values(result.gates).includes('setup')
  await api('/check-runs', 'POST', {
    name: PREVIEW_CHECK, head_sha: target.sha, status: 'completed', conclusion: result.success ? 'success' : 'failure',
    output: {
      title: result.success ? 'Staging preview verified' : anySetup ? 'Setup required' : 'Staging preview verification failed',
      summary: `preview:${target.url}\ngates:${JSON.stringify(result.gates)}`,
      text: result.text.slice(-60000),
    },
  })
  await api('/actions/workflows/approve-and-merge.yml/dispatches', 'POST', { ref: 'main', inputs: { pr_number: String(target.pr.number) } })
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
