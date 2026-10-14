import { readFile } from 'node:fs/promises'
import { approvalSha, checksPass } from './policy.mjs'
import { api, allPages } from './github.mjs'

const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH,'utf8'))
const number = Number(process.env.PR_NUMBER || event.pull_request?.number || event.issue?.number)
if (!Number.isSafeInteger(number) || number < 1) throw new Error('Invalid PR')
const pr = await api(`/pulls/${number}`)
if (pr.state !== 'open' || pr.draft || pr.base.ref !== 'main' || pr.head.repo.full_name !== process.env.GITHUB_REPOSITORY || !pr.head.ref.startsWith('codex/request-')) throw new Error('PR is not eligible for automatic merge')
const owner = process.env.DEVELOPMENT_REVIEWER || 'dmikki'
const [comments, reviews] = await Promise.all([allPages(`/issues/${number}/comments`),allPages(`/pulls/${number}/reviews`)])
const ownerReviews = reviews.filter(r => r.user.login === owner)
const latest = ownerReviews.filter(r => ['APPROVED','CHANGES_REQUESTED','DISMISSED'].includes(r.state)).at(-1)
const reviewed = latest?.state === 'APPROVED' && latest.commit_id === pr.head.sha
const latestCommand = comments.filter(c => c.user.login === owner && (approvalSha(c.body) || c.body.trim() === '/reject')).at(-1)
const commanded = latestCommand && approvalSha(latestCommand.body) === pr.head.sha
const rejected = latestCommand?.body.trim() === '/reject' || latest?.state === 'CHANGES_REQUESTED'
if (rejected || (!reviewed && !commanded)) { console.log('Waiting for owner approval of the current commit.'); process.exit(0) }
const { check_runs: checks } = await api(`/commits/${pr.head.sha}/check-runs?per_page=100`)
const statuses = await api(`/commits/${pr.head.sha}/statuses?per_page=100`)
const base = await api('/git/ref/heads/main')
const latestPr = await api(`/pulls/${number}`)
if (latestPr.head.sha !== pr.head.sha || latestPr.state !== 'open') { console.log('PR changed during review check; waiting for a fresh approval/check run.'); process.exit(0) }
if (!checksPass(checks,statuses,'Development CI',pr.head.sha,base.object.sha)) { console.log('Waiting for checks and Vercel preview. If main changed, rerun Development validation.'); process.exit(0) }
const merged = await api(`/pulls/${number}/merge`,'PUT',{ sha:pr.head.sha, merge_method:'squash' })
if (!merged.merged) throw new Error('GitHub did not merge the PR')
await api(`/issues/${number}/comments`,'POST',{ body:`Owner-approved commit ${pr.head.sha} merged as ${merged.sha}. Vercel will deploy main; the app detects the new version after successful deployment.` })
