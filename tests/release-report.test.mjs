import test from 'node:test'
import assert from 'node:assert/strict'
import { buildReadiness, renderReport, readReportPayload, shouldAutoRemedy, remedyInstructions, REPORT_MARKER } from '../scripts/development/release-report.mjs'
import { checksPass } from '../scripts/development/policy.mjs'

const sha = 'a'.repeat(40)
const base = 'b'.repeat(40)
const run = (name, conclusion, gates, extra = {}) => ({ name, app: { slug: 'github-actions' }, head_sha: sha, status: conclusion ? 'completed' : 'in_progress', conclusion,
  output: { summary: `base:${base}\ngates:${JSON.stringify(gates)}` }, ...extra })
const green = { sha, base, vercel: { state: 'success' }, ci: run('Development CI', 'success', { code: 'success', database: 'success' }),
  preview: run('Preview verification', 'success', { staging: 'success', preview: 'success' }) }

test('everything green but unapproved is ready for the administrator', () => {
  const readiness = buildReadiness({ ...green, approval: 'pending' })
  assert.equal(readiness.verdict, 'ready')
  const markdown = renderReport(readiness)
  assert.match(markdown, /Tested and ready for production/)
  assert.match(markdown, new RegExp(`/approve ${sha}`))
  assert.match(markdown, /\/remedy/)
  assert.match(markdown, /Database: no changes/)
  assert.deepEqual(readReportPayload(markdown).verdict, 'ready')
  assert.ok(markdown.startsWith(REPORT_MARKER))
})

test('approval of a green release becomes a release in progress', () => {
  assert.equal(buildReadiness({ ...green, approval: 'approved' }).verdict, 'approved')
})

test('missing or running checks mean waiting, never ready', () => {
  assert.equal(buildReadiness({ ...green, approval: 'pending', preview: undefined }).verdict, 'waiting')
  assert.equal(buildReadiness({ ...green, approval: 'pending', ci: undefined }).verdict, 'waiting')
  assert.equal(buildReadiness({ ...green, approval: 'pending', vercel: { state: 'pending' } }).verdict, 'waiting')
  const stale = { ...green.ci, output: { summary: `base:${'c'.repeat(40)}\ngates:{}` } }
  assert.equal(buildReadiness({ ...green, approval: 'pending', ci: stale }).verdict, 'waiting')
})

test('failures block with the failing check listed, and rejection blocks even a green release', () => {
  const failed = buildReadiness({ ...green, approval: 'pending', migrations: ['supabase/migrations/20261016000000_add_notes.sql'],
    ci: run('Development CI', 'failure', { code: 'success', database: 'failure' }) })
  assert.equal(failed.verdict, 'blocked')
  assert.equal(failed.gates.find(gate => gate.id === 'database').state, 'failure')
  assert.match(renderReport(failed), /Not ready for production/)
  assert.equal(buildReadiness({ ...green, approval: 'rejected' }).verdict, 'blocked')
  const unexplained = buildReadiness({ ...green, approval: 'pending', ci: run('Development CI', 'failure', { code: 'success' }) })
  assert.equal(unexplained.gates.find(gate => gate.id === 'code').state, 'failure')
})

test('preview failures surface the individual failed checks', () => {
  const preview = run('Preview verification', 'failure', { staging: 'success', preview: 'failure', details: [{ name: 'Preview is isolated from the production database', ok: false, detail: 'PREVIEW USES THE PRODUCTION DATABASE' }, { name: 'Login page renders', ok: true }] })
  const readiness = buildReadiness({ ...green, approval: 'pending', preview })
  assert.equal(readiness.verdict, 'blocked')
  assert.deepEqual(readiness.details, ['Preview is isolated from the production database: PREVIEW USES THE PRODUCTION DATABASE'])
})

test('missing configuration is reported as setup, not as a code failure', () => {
  const preview = run('Preview verification', 'failure', { staging: 'setup', preview: 'success' })
  const readiness = buildReadiness({ ...green, approval: 'pending', migrations: ['supabase/migrations/20261016000000_x.sql'], preview })
  assert.equal(readiness.verdict, 'setup')
  assert.equal(shouldAutoRemedy(readiness, 0), false)
})

test('database changes are described as additive and applied after approval', () => {
  const readiness = buildReadiness({ ...green, approval: 'pending', migrations: ['supabase/migrations/20261016000000_add_notes.sql'] })
  const markdown = renderReport(readiness)
  assert.match(markdown, /20261016000000_add_notes\.sql/)
  assert.match(markdown, /only after you approve/)
  assert.equal(readiness.gates.find(gate => gate.id === 'database').state, 'success')
})

test('rollback releases skip the preview gates and need no database rollback', () => {
  const readiness = buildReadiness({ sha, base, vercel: { state: 'success' }, ci: green.ci, approval: 'approved', rollback: true })
  assert.equal(readiness.verdict, 'approved')
  assert.match(renderReport(readiness), /Additive schema/)
})

test('one automatic remedy is allowed per pull request for failures caused by the change', () => {
  const failed = buildReadiness({ ...green, approval: 'pending', ci: run('Development CI', 'failure', { code: 'failure' }) })
  assert.equal(shouldAutoRemedy(failed, 0), true)
  assert.equal(shouldAutoRemedy(failed, 1), false)
  assert.equal(shouldAutoRemedy(buildReadiness({ ...green, approval: 'rejected' }), 0), false)
  assert.match(remedyInstructions(failed), /Code checks/)
})

test('merge needs the preview verification check and ignores in-flight GitHub Actions jobs', () => {
  const ci = { ...run('Development CI', 'success', {}), output: { summary: `base:${base}` } }
  const preview = run('Preview verification', 'success', {})
  const job = { name: 'record', app: { slug: 'github-actions' }, head_sha: sha, status: 'in_progress', conclusion: null }
  const vercel = { context: 'Vercel', creator: { login: 'vercel[bot]' }, state: 'success' }
  assert.equal(checksPass([ci, preview, job], [vercel], 'Development CI', sha, base, ['Preview verification']), true)
  assert.equal(checksPass([ci, job], [vercel], 'Development CI', sha, base, ['Preview verification']), false)
  assert.equal(checksPass([ci, { ...preview, conclusion: 'failure' }], [vercel], 'Development CI', sha, base, ['Preview verification']), false)
  assert.equal(checksPass([ci, preview, { name: 'Scanner', app: { slug: 'scanner' }, status: 'in_progress' }], [vercel], 'Development CI', sha, base, ['Preview verification']), false)
})
