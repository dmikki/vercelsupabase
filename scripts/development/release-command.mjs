import { readFile } from 'node:fs/promises'
import { api } from './github.mjs'

const owner = process.env.DEVELOPMENT_REVIEWER || 'dmikki'
const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'))
const number = Number(process.env.PR_NUMBER)
const body = (event.comment?.body || '').trim()
const command = /^\/(remedy|rollback)(?:\s+([\s\S]*))?$/.exec(body)
if (!command || event.comment.user.login !== owner || !Number.isSafeInteger(number)) process.exit(0)
const say = text => api(`/issues/${number}/comments`, 'POST', { body: text })
const pr = await api(`/pulls/${number}`)

if (command[1] === 'remedy') {
  const instructions = (command[2] || '').trim()
  const issue = /Closes #(\d+)/.exec(pr.body || '')?.[1]
  if (!instructions) { await say('Add instructions after the command, for example `/remedy make the heading smaller`.'); process.exit(0) }
  if (pr.state !== 'open' || !pr.head.ref.startsWith('codex/request-') || !issue) { await say('`/remedy` works on open pull requests created from an app request.'); process.exit(0) }
  await api('/actions/workflows/codex-implement.yml/dispatches', 'POST', { ref: 'main', inputs: { issue_number: issue, revision_pr: String(number), revision: `Owner instructions for commit ${pr.head.sha}: ${instructions.slice(0, 4000)}` } })
  await say('Remedy requested. Codex will revise this pull request, and the release is tested again from scratch. Approval of the earlier commit no longer applies.')
} else {
  if (!pr.merged_at || pr.base.ref !== 'main') { await say('`/rollback` works on merged pull requests. To stop an unmerged release use `/reject`.'); process.exit(0) }
  await api('/actions/workflows/rollback.yml/dispatches', 'POST', { ref: 'main', inputs: { pr_number: String(number) } })
  await say('Rollback requested. A pull request that reverts this release is being prepared; it ships after its own checks pass, without another approval.')
}
