import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', ...args], { cwd, encoding: 'utf8' }).trim()
const script = new URL('../scripts/development/rollback.mjs', import.meta.url).pathname

function scenario(files) {
  const root = mkdtempSync(join(tmpdir(), 'rollback-'))
  const remote = join(root, 'remote.git')
  const work = join(root, 'work')
  execFileSync('git', ['init', '--bare', '-b', 'main', remote])
  mkdirSync(join(work, 'supabase/migrations'), { recursive: true })
  execFileSync('git', ['init', '-b', 'main', work])
  git(work, 'remote', 'add', 'origin', remote)
  writeFileSync(join(work, 'app.txt'), 'before\n')
  writeFileSync(join(work, 'supabase/migrations/20261001000000_base.sql'), 'select 1;\n')
  git(work, 'add', '-A'); git(work, 'commit', '-m', 'base')
  for (const [path, content] of Object.entries(files)) { mkdirSync(join(work, path, '..'), { recursive: true }); writeFileSync(join(work, path), content) }
  git(work, 'add', '-A'); git(work, 'commit', '-m', 'release')
  const mergeSha = git(work, 'rev-parse', 'HEAD')
  git(work, 'push', 'origin', 'main')
  const stub = join(root, 'stub.mjs')
  writeFileSync(stub, `
    import { appendFileSync } from 'node:fs'
    globalThis.fetch = async (url, init = {}) => {
      const path = new URL(url).pathname.replace('/repos/o/r', '')
      appendFileSync(${JSON.stringify(join(root, 'calls.log'))}, JSON.stringify({ method: init.method || 'GET', path, body: init.body ? JSON.parse(init.body) : null }) + '\\n')
      const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } })
      if (path === '/pulls/7') return json({ number: 7, title: 'Add notes', merged_at: '2026-10-17T00:00:00Z', base: { ref: 'main' }, merge_commit_sha: '${mergeSha}' })
      if (path === '/pulls') return init.method === 'POST' ? json({ number: 8, html_url: 'https://example.test/pull/8' }) : json([])
      return json({})
    }`)
  return { root, work, mergeSha, stub }
}

function rollback({ work, root, stub }) {
  const result = spawnSync('node', ['--import', stub, script], { cwd: work, encoding: 'utf8', env: { ...process.env, GITHUB_REPOSITORY: 'o/r', GH_TOKEN: 'x', PR_NUMBER: '7', GITHUB_RUN_ID: '99' } })
  const calls = existsSync(join(root, 'calls.log')) ? readFileSync(join(root, 'calls.log'), 'utf8').trim().split('\n').map(line => JSON.parse(line)) : []
  return { result, calls }
}

test('rollback reverts application code but keeps the additive migration', () => {
  const s = scenario({ 'app.txt': 'after\n', 'feature.txt': 'new\n', 'supabase/migrations/20261016000000_add_notes.sql': 'create table x();\n' })
  const { result, calls } = rollback(s)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(git(s.work, 'show', 'HEAD:app.txt'), 'before')
  assert.throws(() => git(s.work, 'show', 'HEAD:feature.txt'))
  assert.equal(git(s.work, 'show', 'HEAD:supabase/migrations/20261016000000_add_notes.sql'), 'create table x();')
  const remoteBranch = git(s.work, 'ls-remote', 'origin', 'refs/heads/codex/rollback-7-99').split('\t')[0]
  assert.equal(remoteBranch, git(s.work, 'rev-parse', 'HEAD'))
  const created = calls.find(call => call.method === 'POST' && call.path === '/pulls')
  assert.match(created.body.body, new RegExp(`<!-- rollback-authorized:${remoteBranch} -->`))
  assert.equal(created.body.head, 'codex/rollback-7-99')
  assert.ok(calls.some(call => call.path.endsWith('development-ci.yml/dispatches') && call.body.inputs.head_sha === remoteBranch))
})

test('a release that only changed the schema has nothing to roll back', () => {
  const s = scenario({ 'supabase/migrations/20261016000000_add_notes.sql': 'create table x();\n' })
  const { result, calls } = rollback(s)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(calls.some(call => call.path === '/pulls' && call.method === 'POST'), false)
  assert.ok(calls.some(call => call.path === '/issues/7/comments' && /Nothing to roll back/.test(call.body.body)))
})

test('conflicting later changes stop the rollback with an explanation', () => {
  const s = scenario({ 'app.txt': 'after\n' })
  writeFileSync(join(s.work, 'app.txt'), 'later change\n')
  git(s.work, 'commit', '-am', 'later'); git(s.work, 'push', 'origin', 'main')
  const { result, calls } = rollback(s)
  assert.notEqual(result.status, 0)
  assert.ok(calls.some(call => call.path === '/issues/7/comments' && /manual revert/.test(call.body.body)))
  assert.equal(git(s.work, 'status', '--porcelain'), '')
})
