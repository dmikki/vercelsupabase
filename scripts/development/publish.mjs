import { execFileSync } from 'node:child_process'
import { readFile, lstat } from 'node:fs/promises'
import { allowedPath, forbiddenAddition } from './policy.mjs'
import { api, label, removeLabel } from './github.mjs'

const number = Number(process.env.ISSUE_NUMBER)
if (!Number.isSafeInteger(number) || number < 1) throw new Error('Invalid issue')
const patchPath = `${process.env.RUNNER_TEMP}/proposal/changes.patch`
const patch = await readFile(patchPath)
if (!patch.length || patch.length > 2_000_000) throw new Error('No patch or patch exceeds size limit')
const git = args => execFileSync('git', ['-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false',...args], { encoding: 'utf8' }).trim()
git(['apply','--check','--index',patchPath])
git(['apply','--index',patchPath])
const changed = git(['diff','--cached','--name-only','-z']).split('\0').filter(Boolean)
if (!changed.length || changed.length > 40 || changed.some(path => !allowedPath(path))) throw new Error(`Patch changes protected files or exceeds 40 files: ${changed.filter(path=>!allowedPath(path)).join(', ') || changed.length}`)
const forbidden = forbiddenAddition(git(['diff','--cached','--no-ext-diff','--no-textconv','-U0']))
if (forbidden) throw new Error(`Patch ${forbidden}; this needs manual engineering`)
const entries = []
for (const path of changed) {
  const status = git(['diff','--cached','--name-status','--',path])
  if (status.startsWith('D\t')) { entries.push({ path, mode:'100644', type:'blob', sha:null }); continue }
  const stat = await lstat(path)
  if (!stat.isFile() || stat.size > 1_000_000) throw new Error('Unsupported file type or size')
  const blob = await api('/git/blobs','POST',{ content:(await readFile(path)).toString('base64'), encoding:'base64' })
  entries.push({ path, mode:'100644', type:'blob', sha:blob.sha })
}
const baseSha = git(['rev-parse','HEAD'])
const base = await api(`/git/commits/${baseSha}`)
const tree = await api('/git/trees','POST',{ base_tree:base.tree.sha, tree:entries })
const commit = await api('/git/commits','POST',{ message:`Implement application request #${number}`, tree:tree.sha, parents:[baseSha] })
const summary = (await readFile(`${process.env.RUNNER_TEMP}/proposal/summary.md`,'utf8')).slice(0,12000)
let pr
if (process.env.REVISION_PR) {
  const existing = await api(`/pulls/${Number(process.env.REVISION_PR)}`)
  if (existing.state !== 'open' || existing.head.sha !== baseSha || !existing.head.ref.startsWith(`codex/request-${number}-`)) throw new Error('Revision target changed; rerun from its latest commit')
  await api(`/git/refs/heads/${existing.head.ref}`,'PATCH',{sha:commit.sha,force:false})
  await api(`/issues/${existing.number}/comments`,'POST',{body:`Revision committed as ${commit.sha}.\n\n${summary}\n\nReview again and approve this exact commit: \`/approve ${commit.sha}\`.`})
  pr = existing
} else {
const branch = `codex/request-${number}-${process.env.GITHUB_RUN_ID}`
await api('/git/refs','POST',{ ref:`refs/heads/${branch}`, sha:commit.sha })
pr = await api('/pulls','POST',{ head:branch, base:'main', title:`Implement app request #${number}`,
  body:`Closes #${number}\n\n${summary}\n\n## Approval\nReview the diff and Vercel preview. The owner may approve through GitHub Review → Approve (when the PR author is a different account), or comment:\n\n\`/approve ${commit.sha}\`\n\nMerge requires approval of the current commit, passing Development CI, and a successful Vercel preview. Database/infrastructure changes are excluded from this automated path.` })
await api(`/issues/${number}/comments`,'POST',{ body:`[app-request-pr] #${pr.number}\n\nImplementation ready: ${pr.html_url}` })
}
await removeLabel(number,'codex-running'); await label(number,'codex-ready')
// Explicit dispatch also works when the publishing credential is GITHUB_TOKEN.
await api('/actions/workflows/development-ci.yml/dispatches','POST',{ ref:'main', inputs:{ pr_number:String(pr.number), head_sha:commit.sha } })
console.log(`Created PR ${pr.html_url}`)
