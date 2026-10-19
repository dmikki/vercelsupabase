import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const script = new URL('../scripts/development/approve.mjs', import.meta.url).pathname
const head = 'a'.repeat(40)
const main = 'b'.repeat(40)
const check = (name, conclusion, summary) => ({ name, app: { slug: 'github-actions' }, head_sha: head, status: 'completed', conclusion, output: { summary } })

function run(mode, { comments = [], runs, env = {} }) {
  const dir = mkdtempSync(join(tmpdir(), 'approve-'))
  const calls = join(dir, 'calls.log')
  const world = { comments, runs }
  writeFileSync(join(dir, 'stub.mjs'), `
    import { appendFileSync } from 'node:fs'
    const world = ${JSON.stringify(world)}
    const pr = { number: 5, state: 'open', draft: false, base: { ref: 'main' }, head: { sha: '${head}', ref: 'codex/request-4-1', repo: { full_name: 'o/r' } }, body: 'Closes #4\\n' }
    globalThis.fetch = async (url, init = {}) => {
      const u = new URL(url)
      const path = u.pathname.replace('/repos/o/r', '')
      appendFileSync('${calls}', JSON.stringify({ method: init.method || 'GET', path, body: init.body ? JSON.parse(init.body) : null }) + '\\n')
      const json = value => new Response(JSON.stringify(value), { status: 200 })
      const page = list => json(!u.searchParams.get('page') || u.searchParams.get('page') === '1' ? list : [])
      if (path === '/pulls/5' && init.method === 'PUT') return json({ merged: true })
      if (path === '/pulls/5/merge') return json({ merged: true, sha: 'm'.repeat(40) })
      if (path === '/pulls/5') return json(pr)
      if (path === '/issues/5/comments' && (init.method || 'GET') === 'GET') return page(world.comments)
      if (path === '/pulls/5/reviews' || path === '/pulls/5/files') return page([])
      if (path.endsWith('/check-runs')) return json({ check_runs: world.runs })
      if (path.endsWith('/statuses')) return json([{ context: 'Vercel', creator: { login: 'vercel[bot]' }, state: 'success' }])
      if (path === '/git/ref/heads/main') return json({ object: { sha: '${main}' } })
      return json({})
    }`)
  writeFileSync(join(dir, 'event.json'), '{}')
  const output = join(dir, 'output.txt')
  writeFileSync(output, '')
  const result = spawnSync('node', ['--import', join(dir, 'stub.mjs'), script, mode], { encoding: 'utf8',
    env: { ...process.env, GITHUB_REPOSITORY: 'o/r', GH_TOKEN: 'x', GH_CHECKS_TOKEN: 'y', PR_NUMBER: '5', GITHUB_EVENT_PATH: join(dir, 'event.json'), GITHUB_OUTPUT: output, ...env } })
  const log = existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : []
  return { result, log, output: readFileSync(output, 'utf8') }
}

const failingCi = check('Development CI', 'failure', `base:${main}\ngates:{"code":"failure","database":"skipped"}`)
const passing = [check('Development CI', 'success', `base:${main}\ngates:{"code":"success","database":"skipped"}`), check('Preview verification', 'success', 'gates:{"staging":"success","preview":"success"}')]

test('a failed check refreshes the report and asks Codex for exactly one automatic repair', () => {
  const first = run('evaluate', { runs: [failingCi] })
  assert.equal(first.result.status, 0, first.result.stderr)
  assert.ok(first.log.some(call => call.method === 'POST' && call.path === '/issues/5/comments' && call.body.body.includes('Release readiness')))
  const dispatch = first.log.find(call => call.path.endsWith('codex-implement.yml/dispatches'))
  assert.equal(dispatch.body.inputs.issue_number, '4')
  assert.equal(dispatch.body.inputs.revision_pr, '5')
  assert.match(dispatch.body.inputs.revision, /Code checks/)
  assert.equal(first.output.trim(), 'ready=[]')
  const second = run('evaluate', { runs: [failingCi], comments: [{ id: 1, user: { login: 'github-actions[bot]', type: 'Bot' }, body: `[auto-remedy] ${head}` }] })
  assert.equal(second.log.some(call => call.path.endsWith('dispatches')), false)
})

test('an approved, tested commit is handed to the release job with its migrations', () => {
  const { result, output } = run('evaluate', { runs: passing, comments: [{ id: 1, user: { login: 'dmikki' }, body: `/approve ${head}` }] })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(output.trim().replace('ready=', '')), [{ number: 5, sha: head, migrations: '', rollback: false }])
})

test('the merge step re-checks everything and reports the production migrations it follows', () => {
  const approved = { runs: passing, comments: [{ id: 1, user: { login: 'dmikki' }, body: `/approve ${head}` }] }
  const merged = run('merge', { ...approved, env: { EXPECTED_SHA: head, PRODUCTION_MIGRATIONS: 'supabase/migrations/20261016000000_add_notes.sql' } })
  assert.equal(merged.result.status, 0, merged.result.stderr)
  assert.ok(merged.log.some(call => call.method === 'PUT' && call.path === '/pulls/5/merge' && call.body.sha === head && call.body.merge_method === 'squash'))
  const comment = merged.log.find(call => call.method === 'POST' && call.path === '/issues/5/comments')
  assert.match(comment.body.body, /20261016000000_add_notes\.sql/)
  assert.match(comment.body.body, /\/rollback/)
  const stale = run('merge', { ...approved, env: { EXPECTED_SHA: 'c'.repeat(40) } })
  assert.equal(stale.log.some(call => call.method === 'PUT'), false)
  const unapproved = run('merge', { runs: passing, env: { EXPECTED_SHA: head } })
  assert.equal(unapproved.log.some(call => call.method === 'PUT'), false)
})
