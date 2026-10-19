import test from 'node:test'
import assert from 'node:assert/strict'
import { readinessFromComments, productionFromComments, readinessSummary, REPORT_MARKER } from '../lib/release-readiness.ts'
import { buildReadiness, renderReport, REPORT_MARKER as SCRIPT_MARKER } from '../scripts/development/release-report.mjs'

const sha = 'a'.repeat(40)
const gates = { code: 'success', database: 'success' }
const run = (name, conclusion, summary) => ({ name, app: { slug: 'github-actions' }, head_sha: sha, status: 'completed', conclusion, output: { summary } })
const report = renderReport(buildReadiness({ sha, base: 'b'.repeat(40), vercel: { state: 'success' }, approval: 'pending',
  ci: run('Development CI', 'success', `base:${'b'.repeat(40)}\ngates:${JSON.stringify(gates)}`),
  preview: run('Preview verification', 'success', 'gates:{"staging":"skipped","preview":"success"}') }))

test('the portal reads exactly what the pipeline writes', () => {
  assert.equal(REPORT_MARKER, SCRIPT_MARKER)
  const readiness = readinessFromComments([{ body: report, user: { type: 'Bot' } }])
  assert.equal(readiness.verdict, 'ready')
  assert.equal(readiness.sha, sha)
  assert.equal(readinessSummary(readiness).failed.length, 0)
})

test('reports from people are ignored, and the latest bot report wins', () => {
  assert.equal(readinessFromComments([{ body: report, user: { type: 'User' } }]), null)
  const blocked = report.replace('"verdict":"ready"', '"verdict":"blocked"')
  assert.equal(readinessFromComments([{ body: report, user: { type: 'Bot' } }, { body: blocked, user: { type: 'Bot' } }]).verdict, 'blocked')
  assert.equal(readinessFromComments([{ body: `${REPORT_MARKER}\n<!-- readiness:{broken} -->`, user: { type: 'Bot' } }]), null)
})

test('production verification results come only from the bot', () => {
  const marker = ok => `<!-- production-verification:${JSON.stringify({ ok, sha })} -->`
  assert.deepEqual(productionFromComments([{ body: marker(true), user: { type: 'Bot' } }]), { ok: true, sha })
  assert.equal(productionFromComments([{ body: marker(true), user: { type: 'User' } }]), null)
  assert.equal(productionFromComments([{ body: marker(true), user: { type: 'Bot' } }, { body: marker(false), user: { type: 'Bot' } }]).ok, false)
})
