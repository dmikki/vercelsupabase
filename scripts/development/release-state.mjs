import { appendFile } from 'node:fs/promises'
import { approvalSha, checksPass } from './policy.mjs'
import { buildReadiness, REPORT_MARKER, renderReport } from './release-report.mjs'
import { migrationPath } from './migration-policy.mjs'
import { allPages, api } from './github.mjs'

export const CI_CHECK = 'Development CI'
export const PREVIEW_CHECK = 'Preview verification'
export const isAutomationBranch = ref => ref.startsWith('codex/request-') || ref.startsWith('codex/rollback-')

function vercelGate(runs, statuses) {
  const latest = new Map()
  for (const status of statuses) if (!latest.has(status.context)) latest.set(status.context, status)
  const fromStatuses = [...latest.values()].filter(status => status.context.toLowerCase().includes('vercel') && status.creator?.login === 'vercel[bot]').map(status => status.state)
  const fromChecks = runs.filter(run => run.app?.slug === 'vercel').map(run => run.status !== 'completed' ? 'pending' : run.conclusion === 'success' ? 'success' : 'failure')
  const states = [...fromStatuses.map(state => state === 'success' ? 'success' : state === 'pending' ? 'pending' : 'failure'), ...fromChecks]
  if (!states.length) return { state: 'pending', detail: 'Waiting for Vercel to report' }
  if (states.includes('failure')) return { state: 'failure', detail: 'The preview build failed' }
  return { state: states.includes('pending') ? 'pending' : 'success' }
}

function otherChecks(runs) {
  return runs.filter(run => !['github-actions', 'vercel'].includes(run.app?.slug)).map(run => ({
    name: run.name,
    state: run.status !== 'completed' ? 'pending' : ['success', 'neutral', 'skipped'].includes(run.conclusion) ? 'success' : 'failure',
  })).filter(check => check.state !== 'success')
}

export async function evaluatePullRequest(number, { owner = process.env.DEVELOPMENT_REVIEWER || 'dmikki', checksToken = process.env.GH_CHECKS_TOKEN } = {}) {
  const pr = await api(`/pulls/${number}`)
  if (pr.state !== 'open' || pr.draft || pr.base.ref !== 'main' || pr.head.repo.full_name !== process.env.GITHUB_REPOSITORY || !isAutomationBranch(pr.head.ref)) return { ignored: true, pr }
  const rollback = pr.head.ref.startsWith('codex/rollback-')
  const [comments, reviews, files] = await Promise.all([allPages(`/issues/${number}/comments`), allPages(`/pulls/${number}/reviews`), allPages(`/pulls/${number}/files`)])
  const ownerReviews = reviews.filter(review => review.user.login === owner)
  const latest = ownerReviews.filter(review => ['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state)).at(-1)
  const reviewed = latest?.state === 'APPROVED' && latest.commit_id === pr.head.sha
  const latestCommand = comments.filter(comment => comment.user.login === owner && (approvalSha(comment.body) || comment.body.trim() === '/reject')).at(-1)
  const commanded = Boolean(latestCommand) && approvalSha(latestCommand.body) === pr.head.sha
  const rejected = latestCommand?.body.trim() === '/reject' || latest?.state === 'CHANGES_REQUESTED'
  const rollbackAuthorized = rollback && (pr.body || '').includes(`<!-- rollback-authorized:${pr.head.sha} -->`)
  const approval = rejected ? 'rejected' : reviewed || commanded || rollbackAuthorized ? 'approved' : 'pending'
  const migrations = files.filter(file => file.status === 'added' && migrationPath(file.filename)).map(file => file.filename)

  const { check_runs: runs } = await api(`/commits/${pr.head.sha}/check-runs?per_page=100`, 'GET', undefined, checksToken)
  const statuses = await api(`/commits/${pr.head.sha}/statuses?per_page=100`)
  const base = await api('/git/ref/heads/main')
  const named = name => runs.find(run => run.name === name && run.app?.slug === 'github-actions' && run.head_sha === pr.head.sha)
  const preview = named(PREVIEW_CHECK)
  const previewUrl = /^preview:(\S+)$/m.exec(preview?.output?.summary || '')?.[1] || ''
  const readiness = buildReadiness({
    sha: pr.head.sha, base: base.object.sha, migrations, ci: named(CI_CHECK), preview, vercel: vercelGate(runs, statuses),
    approval, rollback, others: otherChecks(runs), previewUrl,
  })
  const latestPr = await api(`/pulls/${number}`)
  const unchanged = latestPr.head.sha === pr.head.sha && latestPr.state === 'open'
  const eligible = unchanged && approval === 'approved' && checksPass(runs, statuses, CI_CHECK, pr.head.sha, base.object.sha, rollback ? [] : [PREVIEW_CHECK])
  return { pr, readiness, report: renderReport(readiness), eligible, migrations, rollback, comments, baseSha: base.object.sha, runs }
}

// Keeps one bot-authored report comment up to date instead of posting a new comment per event.
export async function upsertReport(number, body, comments, token = process.env.GH_CHECKS_TOKEN) {
  const existing = comments.find(comment => comment.body?.includes(REPORT_MARKER) && comment.user?.type === 'Bot')
  if (existing?.body === body) return
  if (existing) await api(`/issues/comments/${existing.id}`, 'PATCH', { body }, token)
  else await api(`/issues/${number}/comments`, 'POST', { body }, token)
}

export async function targetPullRequests(event, explicit) {
  if (explicit) return [Number(explicit)]
  const sha = event.sha || event.check_run?.head_sha
  if (event.pull_request?.number) return [event.pull_request.number]
  if (event.issue?.number) return [event.issue.number]
  if (!/^[0-9a-f]{40}$/.test(sha || '')) return []
  const prs = await api(`/commits/${sha}/pulls`)
  return prs.filter(pr => pr.state === 'open' && isAutomationBranch(pr.head.ref)).map(pr => pr.number)
}

export async function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`)
}
