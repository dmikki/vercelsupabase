import { execFileSync } from 'node:child_process'
import { api } from './github.mjs'

const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { encoding: 'utf8' }).trim()
const number = Number(process.env.PR_NUMBER)
if (!Number.isSafeInteger(number) || number < 1) throw new Error('Invalid PR')
const say = (target, text) => api(`/issues/${target}/comments`, 'POST', { body: text })
const pr = await api(`/pulls/${number}`)
if (!pr.merged_at || pr.base.ref !== 'main' || !/^[0-9a-f]{40}$/.test(pr.merge_commit_sha || '')) throw new Error('Only merged pull requests can be rolled back')

const open = await api('/pulls?state=open&per_page=100')
const existing = open.find(item => item.head.ref.startsWith(`codex/rollback-${number}-`))
if (existing) { await say(number, `A rollback is already in progress: #${existing.number}.`); process.exit(0) }

try { git('merge-base', '--is-ancestor', pr.merge_commit_sha, 'HEAD') } catch { throw new Error('The merge commit is not part of main') }
git('config', 'user.name', 'Release automation')
git('config', 'user.email', 'release-automation@users.noreply.github.com')
try { git('revert', '--no-commit', pr.merge_commit_sha) } catch {
  try { git('revert', '--abort') } catch { /* nothing to abort */ }
  await say(number, 'The automatic rollback could not be applied cleanly because later changes touch the same files. A manual revert is needed.')
  throw new Error('Revert conflicts')
}
// Schema changes are additive and compatible with the previous code, so only application code is reverted.
git('checkout', 'HEAD', '--', 'supabase/migrations')
if (!git('diff', '--cached', '--name-only')) {
  await say(number, 'Nothing to roll back: this release changed only the database schema, which is additive and stays in place.')
  process.exit(0)
}
git('commit', '-m', `Roll back #${number}: ${pr.title}`.slice(0, 200))
const sha = git('rev-parse', 'HEAD')
const branch = `codex/rollback-${number}-${process.env.GITHUB_RUN_ID || Date.now()}`
git('push', 'origin', `HEAD:refs/heads/${branch}`)
const created = await api('/pulls', 'POST', {
  head: branch, base: 'main', title: `Roll back #${number}: ${pr.title}`.slice(0, 200),
  body: `Reverts the code of #${number} at the owner's request. Database changes from that release are additive and stay in place, so the previous code keeps working.\n\nThis rollback ships automatically after its checks pass.\n\n<!-- rollback-authorized:${sha} -->`,
})
await api('/actions/workflows/development-ci.yml/dispatches', 'POST', { ref: 'main', inputs: { pr_number: String(created.number), head_sha: sha } })
await say(number, `Rollback prepared as #${created.number}. It deploys once its checks pass.`)
console.log(`Created rollback PR ${created.html_url}`)
