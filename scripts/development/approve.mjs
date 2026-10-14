import {hasAutomaticApproval} from './auto-policy.mjs'
import { readFile } from 'node:fs/promises'
import { approvalSha, checksPass } from './policy.mjs'
import { api, allPages } from './github.mjs'

const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH,'utf8'))
const number = Number(process.env.PR_NUMBER || event.pull_request?.number || event.issue?.number)
if (!Number.isSafeInteger(number) || number < 1) throw new Error('Invalid PR')
const pr = await api(`/pulls/${number}`)
if (pr.state !== 'open' || pr.draft || pr.base.ref !== 'main' || pr.head.repo.full_name !== process.env.GITHUB_REPOSITORY || !pr.head.ref.startsWith('codex/request-')) {console.log('PR is not eligible for automatic merge; ignoring event.');process.exit(0)}
const owner = process.env.DEVELOPMENT_REVIEWER || 'dmikki'
const [comments, reviews] = await Promise.all([allPages(`/issues/${number}/comments`),allPages(`/pulls/${number}/reviews`)])
const ownerReviews = reviews.filter(r => r.user.login === owner)
const latest = ownerReviews.filter(r => ['APPROVED','CHANGES_REQUESTED','DISMISSED'].includes(r.state)).at(-1)
const reviewed = latest?.state === 'APPROVED' && latest.commit_id === pr.head.sha
const latestCommand = comments.filter(c => c.user.login === owner && (approvalSha(c.body) || c.body.trim() === '/reject')).at(-1)
const commanded = latestCommand && approvalSha(latestCommand.body) === pr.head.sha
const rejected = latestCommand?.body.trim() === '/reject' || latest?.state === 'CHANGES_REQUESTED'
const { check_runs: checks } = await api(`/commits/${pr.head.sha}/check-runs?per_page=100`, 'GET', undefined, process.env.GH_CHECKS_TOKEN)
const automated=checks.some(check=>hasAutomaticApproval(check,pr.head.sha))
if(rejected||(!reviewed&&!commanded&&!automated)){console.log('Waiting for owner approval: no qualifying below-$1 CI attestation.');process.exit(0)}
const statuses = await api(`/commits/${pr.head.sha}/statuses?per_page=100`)
const base = await api('/git/ref/heads/main')
const latestPr = await api(`/pulls/${number}`)
if (latestPr.head.sha !== pr.head.sha || latestPr.state !== 'open') { console.log('PR changed during review check; waiting for a fresh approval/check run.'); process.exit(0) }
if (!checksPass(checks,statuses,'Development CI',pr.head.sha,base.object.sha)) {
  const ci=checks.find(c=>c.name==='Development CI'&&c.app?.slug==='github-actions'&&c.head_sha===pr.head.sha)
  if(ci?.conclusion==='success'&&!ci.output?.summary?.includes(`base:${base.object.sha}`)) {
    const marker=`[app-request-revalidate] ${pr.head.sha} ${base.object.sha}`
    if(!comments.some(c=>c.body===marker)) {
      await api('/actions/workflows/development-ci.yml/dispatches','POST',{ref:'main',inputs:{pr_number:String(number),head_sha:pr.head.sha}})
      await api(`/issues/${number}/comments`,'POST',{body:marker})
      console.log('Main changed; fresh merge validation dispatched automatically.')
    }
  }
  console.log('Waiting for checks and Vercel preview.'); process.exit(0)
}
const merged = await api(`/pulls/${number}/merge`,'PUT',{ sha:pr.head.sha, merge_method:'squash' })
if (!merged.merged) throw new Error('GitHub did not merge the PR')
await api(`/issues/${number}/comments`,'POST',{ body:`${automated?'Automatically approved below-$1':'Owner-approved'} commit ${pr.head.sha} merged as ${merged.sha}. Vercel will deploy main; the app detects the new version after successful deployment.` })
