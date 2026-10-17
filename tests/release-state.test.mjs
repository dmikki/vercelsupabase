import test from 'node:test'
import assert from 'node:assert/strict'

process.env.GITHUB_REPOSITORY = 'o/r'
process.env.GH_TOKEN = 'token'
const { evaluatePullRequest, targetPullRequests, upsertReport } = await import('../scripts/development/release-state.mjs')

const head = 'a'.repeat(40)
const main = 'b'.repeat(40)
const check = (name, conclusion = 'success', summary = '') => ({ name, app: { slug: 'github-actions' }, head_sha: head, status: 'completed', conclusion, output: { summary } })

function world(overrides = {}) {
  const state = {
    pr: { number: 5, state: 'open', draft: false, base: { ref: 'main' }, head: { sha: head, ref: 'codex/request-4-1', repo: { full_name: 'o/r' } }, body: 'Closes #4\n' },
    comments: [{ id: 1, user: { login: 'dmikki' }, body: `/approve ${head}` }],
    reviews: [], files: [],
    runs: [check('Development CI', 'success', `base:${main}\ngates:{"code":"success","database":"skipped"}`), check('Preview verification', 'success', 'preview:https://p.example\ngates:{"staging":"skipped","preview":"success"}')],
    statuses: [{ context: 'Vercel', creator: { login: 'vercel[bot]' }, state: 'success' }],
    ...overrides,
  }
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    const { pathname } = new URL(url)
    const path = pathname.replace('/repos/o/r', '')
    calls.push({ method: init.method || 'GET', path, body: init.body ? JSON.parse(init.body) : null })
    const json = value => new Response(JSON.stringify(value), { status: 200 })
    const page = list => new URL(url).searchParams.get('page') === '1' || !new URL(url).searchParams.get('page') ? json(list) : json([])
    if (path === '/pulls/5') return json(state.pr)
    if (path === '/issues/5/comments') return page(state.comments)
    if (path === '/pulls/5/reviews') return page(state.reviews)
    if (path === '/pulls/5/files') return page(state.files)
    if (path.endsWith('/check-runs')) return json({ check_runs: state.runs })
    if (path.endsWith('/statuses')) return json(state.statuses)
    if (path === '/git/ref/heads/main') return json({ object: { sha: main } })
    if (path === `/commits/${head}/pulls`) return json([state.pr])
    return json({})
  }
  return { state, calls }
}

test('an approved, fully tested commit is eligible and reported as releasing', async () => {
  world()
  const result = await evaluatePullRequest(5)
  assert.equal(result.eligible, true)
  assert.equal(result.readiness.verdict, 'approved')
  assert.match(result.report, /https:\/\/p\.example/)
})

test('a green but unapproved commit is ready for the administrator and not eligible', async () => {
  world({ comments: [] })
  const result = await evaluatePullRequest(5)
  assert.equal(result.eligible, false)
  assert.equal(result.readiness.verdict, 'ready')
})

test('approval of an earlier commit, or a rejection, never releases', async () => {
  world({ comments: [{ id: 1, user: { login: 'dmikki' }, body: `/approve ${'c'.repeat(40)}` }] })
  assert.equal((await evaluatePullRequest(5)).eligible, false)
  world({ comments: [{ id: 1, user: { login: 'dmikki' }, body: `/approve ${head}` }, { id: 2, user: { login: 'dmikki' }, body: '/reject' }] })
  const rejected = await evaluatePullRequest(5)
  assert.equal(rejected.eligible, false)
  assert.equal(rejected.readiness.verdict, 'blocked')
  world({ comments: [{ id: 1, user: { login: 'someone-else' }, body: `/approve ${head}` }] })
  assert.equal((await evaluatePullRequest(5)).eligible, false)
})

test('without a verified staging preview nothing is eligible', async () => {
  world({ runs: [check('Development CI', 'success', `base:${main}\ngates:{"code":"success","database":"skipped"}`)] })
  const result = await evaluatePullRequest(5)
  assert.equal(result.eligible, false)
  assert.equal(result.readiness.verdict, 'waiting')
})

test('migrations added by the pull request are listed for the production release', async () => {
  world({ files: [{ filename: 'supabase/migrations/20261016000000_add_notes.sql', status: 'added' }, { filename: 'app/x.tsx', status: 'modified' }],
    runs: [check('Development CI', 'success', `base:${main}\ngates:{"code":"success","database":"success"}`), check('Preview verification', 'success', 'preview:https://p.example\ngates:{"staging":"success","preview":"success"}')] })
  const result = await evaluatePullRequest(5)
  assert.deepEqual(result.migrations, ['supabase/migrations/20261016000000_add_notes.sql'])
  assert.equal(result.eligible, true)
  assert.match(result.report, /Migrations applied and integration tests passed on staging/)
})

test('a rollback pull request is authorized by its own marker and skips the preview gate', async () => {
  const marker = `<!-- rollback-authorized:${head} -->`
  world({ comments: [], runs: [check('Development CI', 'success', `base:${main}\ngates:{"code":"success","database":"skipped"}`)],
    pr: { number: 5, state: 'open', draft: false, base: { ref: 'main' }, head: { sha: head, ref: 'codex/rollback-4-1', repo: { full_name: 'o/r' } }, body: `Rolls back\n${marker}` } })
  const result = await evaluatePullRequest(5)
  assert.equal(result.eligible, true)
  assert.equal(result.rollback, true)
  world({ comments: [], pr: { number: 5, state: 'open', draft: false, base: { ref: 'main' }, head: { sha: head, ref: 'codex/rollback-4-1', repo: { full_name: 'o/r' } }, body: `<!-- rollback-authorized:${'c'.repeat(40)} -->` } })
  assert.equal((await evaluatePullRequest(5)).eligible, false)
})

test('pull requests outside the automation branches are ignored', async () => {
  const { state } = world()
  state.pr.head.ref = 'feature/manual'
  assert.equal((await evaluatePullRequest(5)).ignored, true)
})

test('the report comment is created once and then edited only when it changes', async () => {
  const { calls } = world()
  await upsertReport(5, 'body one', [], 'token')
  assert.equal(calls.at(-1).method, 'POST')
  await upsertReport(5, 'body two', [{ id: 9, body: '<!-- release-readiness -->\nold', user: { type: 'Bot' } }], 'token')
  assert.deepEqual([calls.at(-1).method, calls.at(-1).path], ['PATCH', '/issues/comments/9'])
  const before = calls.length
  await upsertReport(5, '<!-- release-readiness -->\nsame', [{ id: 9, body: '<!-- release-readiness -->\nsame', user: { type: 'Bot' } }], 'token')
  assert.equal(calls.length, before)
  await upsertReport(5, 'new', [{ id: 10, body: '<!-- release-readiness -->\nspoof', user: { type: 'User' } }], 'token')
  assert.equal(calls.at(-1).method, 'POST')
})

test('events resolve to the open automation pull requests they affect', async () => {
  world()
  assert.deepEqual(await targetPullRequests({ sha: head }), [5])
  assert.deepEqual(await targetPullRequests({}, '12'), [12])
  assert.deepEqual(await targetPullRequests({ issue: { number: 3 } }), [3])
  assert.deepEqual(await targetPullRequests({ sha: 'nope' }), [])
})
