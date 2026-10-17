import { readFile } from 'node:fs/promises'
import { evaluatePullRequest, setOutput, targetPullRequests, upsertReport } from './release-state.mjs'
import { remedyInstructions, shouldAutoRemedy } from './release-report.mjs'
import { api } from './github.mjs'

const mode = process.argv[2] || 'evaluate'
const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'))

async function autoRemedy(result) {
  const { pr, readiness, comments } = result
  const used = comments.filter(comment => /^\[auto-remedy\]/m.test(comment.body || '')).length
  if (!pr.head.ref.startsWith('codex/request-') || !shouldAutoRemedy(readiness, used)) return
  const issue = /Closes #(\d+)/.exec(pr.body || '')?.[1]
  if (!issue) return
  await api(`/issues/${pr.number}/comments`, 'POST', { body: `[auto-remedy] ${pr.head.sha}\n\nA release check failed for this commit. Codex was asked to repair it automatically once; the release is tested again from scratch afterwards. You can also comment \`/remedy <instructions>\`.` }, process.env.GH_CHECKS_TOKEN)
  await api('/actions/workflows/codex-implement.yml/dispatches', 'POST', { ref: 'main', inputs: { issue_number: issue, revision_pr: String(pr.number), revision: remedyInstructions(readiness) } })
}

if (mode === 'evaluate') {
  const ready = []
  for (const number of await targetPullRequests(event, process.env.PR_NUMBER)) {
    try {
      const result = await evaluatePullRequest(number)
      if (result.ignored) { console.log(`PR #${number} is not eligible for automation; ignoring.`); continue }
      await upsertReport(number, result.report, result.comments)
      console.log(`PR #${number}: ${result.readiness.verdict}`)
      await autoRemedy(result)
      if (result.eligible) ready.push({ number, sha: result.pr.head.sha, migrations: result.migrations.join(','), rollback: result.rollback })
    } catch (error) { console.error(`PR #${number}: ${error.message}`); process.exitCode = 1 }
  }
  await setOutput('ready', JSON.stringify(ready))
} else if (mode === 'merge') {
  const number = Number(process.env.PR_NUMBER)
  const result = await evaluatePullRequest(number)
  if (result.ignored || !result.eligible || result.pr.head.sha !== process.env.EXPECTED_SHA) { console.log('Approval, checks, or the commit changed since evaluation; not merging.'); process.exit(0) }
  const merged = await api(`/pulls/${number}/merge`, 'PUT', { sha: result.pr.head.sha, merge_method: 'squash' })
  if (!merged.merged) throw new Error('GitHub did not merge the PR')
  const database = process.env.PRODUCTION_MIGRATIONS ? ` Production database: applied ${process.env.PRODUCTION_MIGRATIONS.split(',').map(name => `\`${name.split('/').pop()}\``).join(', ')} before this merge.` : ''
  await api(`/issues/${number}/comments`, 'POST', { body: `Owner-approved commit ${result.pr.head.sha} merged as ${merged.sha}.${database} Vercel is deploying main; the release is verified automatically after the deployment, and you can comment \`/rollback\` on this pull request to undo it.` })
  await setOutput('merged', merged.sha)
} else throw new Error(`Unknown mode ${mode}`)
