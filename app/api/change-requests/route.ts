import {canViewRepositoryLinks, requestForViewer} from '@/lib/change-request-access'
import {ownedAttachments,attachmentContext,referenceManifest,requestAttachments} from '@/lib/change-request-attachments-server'
import {ATTACHMENT_BUCKET} from '@/lib/change-request-attachments'
import { requestContext, requestAdmin, requestError } from '@/lib/change-requests-server'
import { cached, ensureRequestIssue, forget, github, issueProgressKey, type GitHubIssue, type GitHubPull } from '@/lib/development-github'
import { estimateChange, mayAutoApprove, tokenCost, MODEL } from '@/lib/change-request-cost'
import { verifyEstimate } from '@/lib/change-request-estimates-server'
import { parseChangeRequest } from '@/lib/change-request-validation'
import { productionFromComments, readinessFromComments, type ProductionCheck, type Readiness } from '@/lib/release-readiness'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const { supabase, user, isAdmin } = await requestContext(request)
    const body = await request.text()
    if (body.length > 50000) throw new Error('Request is too large.')
    const parsed = JSON.parse(body)
    const input = parseChangeRequest(parsed)
    const files=await ownedAttachments(user.id,parsed.attachments,input.id)
    const context=attachmentContext(files,input.kind)
    const estimate = verifyEstimate(parsed.estimateToken,user.id,input.title,input.description,context)
    const fingerprint=context+JSON.stringify(estimate)
    const autoApproved = mayAutoApprove(isAdmin,parsed.acceptEstimate === true,estimate)
    const admin = requestAdmin()
    const { error } = await supabase.rpc('submit_change_request', {
      request_id: input.id, request_title: input.title, request_description: input.description,
    })
    if (error) throw new Error(error.message.includes('Daily request limit') ? 'Daily request limit reached (5 per day).' : 'Unable to save request. Check that the database migration has been applied.')
    const { data: row, error: readError } = await admin.from('change_requests').select('*').eq('id', input.id).eq('user_id', user.id).single()
    if (readError || !row) throw new Error('Unable to find your request.')
    if (row.title !== input.title || row.description !== input.description || (row.github_issue_number && row.kind !== input.kind)) throw new Error('Request ID already belongs to different content.')
    if (row.github_issue_number) return Response.json({ id: row.id, status: 'submitted' })
    const approved=autoApproved||(row.auto_authorized===true&&row.authorization_fingerprint===fingerprint)
    // A lease prevents concurrent retries from publishing the same request.
    if (row.status === 'publishing' && Date.now() - new Date(row.updated_at).getTime() < 120000)
      return Response.json({ id: row.id, status: 'publishing' }, { status: 202 })
    const { data: claimed, error: claimError } = await admin.from('change_requests')
      .update({ estimate, kind:input.kind, auto_authorized: approved, authorization_fingerprint:fingerprint, status: 'publishing', updated_at: new Date().toISOString() })
      .eq('id', row.id).eq('updated_at', row.updated_at).select('id')
    if (claimError) throw new Error('Unable to reserve request for publication.')
    if (!claimed?.length) return Response.json({ id: row.id, status: 'publishing' }, { status: 202 })
    try {
      if(files.length) {const {data:linked,error:linkError}=await admin.from('change_request_attachments').update({request_id:row.id}).eq('user_id',user.id).in('id',files.map(f=>f.id)).eq('ready',true).or(`request_id.is.null,request_id.eq.${row.id}`).select('id');if(linkError||linked?.length!==files.length)throw Error('Unable to link attachments.')}
      const references=await referenceManifest(files)
      const issue = await ensureRequestIssue({ ...row, kind:input.kind, references, estimate }, approved)
      forget(issueProgressKey(issue.number))
      const { error: saveError } = await admin.from('change_requests').update({
        github_issue_number: issue.number, status: 'submitted', updated_at: new Date().toISOString(),
      }).eq('id', row.id)
      if (saveError) throw new Error('GitHub received the request, but its status could not be saved. Retry to reconcile.')
      return Response.json({ id: row.id, status: 'submitted' }, { status: 201 })
    } catch (error) {
      await admin.from('change_requests').update({ status: 'github_pending', updated_at: new Date().toISOString() }).eq('id', row.id)
      throw error
    }
  } catch (error) { return requestError(error) }
}

async function issueProgress(number: number) {
  const issue = await github<GitHubIssue>(`/issues/${number}`)
  const labels = issue.labels.map(label => label.name)
  let status = labels.includes('codex-failed') ? 'failed' : labels.includes('codex-running') ? 'implementing' : labels.includes('codex-ready') ? 'review' : labels.includes('codex-approved') ? 'queued' : 'awaiting_authorization'
  const comments = await github<{ body: string; user: { login: string; type: string } }[]>(`/issues/${issue.number}/comments?per_page=100`)
  const prNumber = comments.map(c => c.body.match(/^\[app-request-pr\] #(\d+)$/m)?.[1]).filter(Boolean).at(-1)
  let prUrl: string | undefined
  let readiness: Readiness | null = null
  let production: ProductionCheck | null = null
  if (prNumber) {
    const pr = await github<GitHubPull>(`/pulls/${prNumber}`)
    prUrl = pr.html_url
    if (pr.state === 'open' || pr.merged_at) {
      const prComments: { body?: string; user?: { type?: string } }[] = []
      for (let page = 1; page <= 5; page++) {
        const batch = await github<typeof prComments>(`/issues/${prNumber}/comments?per_page=100&page=${page}`)
        prComments.push(...batch)
        if (batch.length < 100) break
      }
      if (pr.merged_at) production = productionFromComments(prComments)
      else readiness = readinessFromComments(prComments)
    }
    if (pr.merged_at) status = 'merged'
    else if (pr.state === 'closed') status = 'closed'
    if (pr.merged_at && pr.merge_commit_sha && process.env.VERCEL_ENV === 'production' && process.env.VERCEL_GIT_COMMIT_SHA) {
      const comparison = await github<{ status: string }>(`/compare/${pr.merge_commit_sha}...${process.env.VERCEL_GIT_COMMIT_SHA}`)
      if (['identical', 'ahead'].includes(comparison.status)) status = 'deployed'
    }
  }
  const usageRuns = new Map<string, { input: number; cached: number; output: number; usd: number; complete: boolean; available: boolean }>()
  for (const comment of comments) {
    if (comment.user?.login !== 'github-actions[bot]' || comment.user?.type !== 'Bot') continue
    const match = comment.body.match(/^\[app-request-usage\] (.+)$/m)
    if (!match) continue
    try { const u = JSON.parse(match[1]); if (u.model !== MODEL || !/^\d+:\d+$/.test(u.run)) continue; const usd=tokenCost(u.input,u.cached,u.output); usageRuns.set(u.run,{input:u.input,cached:u.cached,output:u.output,usd,complete:u.complete===true,available:Number.isSafeInteger(u.turns)&&u.turns>0}) } catch { /* Invalid reports are ignored. */ }
  }
  return { status, usage: [...usageRuns.values()], issue_url: issue.html_url, pr_url: prUrl, readiness, production }
}

export async function GET() {
  try {
    const { supabase, user, isAdmin } = await requestContext()
    const canViewLinks = canViewRepositoryLinks(user, isAdmin)
    const { data, error } = await (isAdmin ? requestAdmin() : supabase).from('change_requests')
      .select('id,title,description,status,github_issue_number,created_at,estimate,kind').order('created_at', { ascending: false }).limit(10)
    if (error) throw new Error('Unable to load requests. Check that the database migration has been applied.')
    const requests = await Promise.all((data || []).map(async row => {
      const attached=await requestAttachments(row.id)
      const attachments=await Promise.all(attached.map(async f=>{const {data}=await requestAdmin().storage.from(ATTACHMENT_BUCKET).createSignedUrl(f.storage_path,3600);return {id:f.id,name:f.name,mime:f.mime,size:f.size,url:data?.signedUrl}}))
      if (!row.github_issue_number) return {...row,attachments}
      try {
        const progress = await cached(issueProgressKey(row.github_issue_number), () => issueProgress(row.github_issue_number),
          p => ['deployed', 'closed'].includes(p.status) ? 600000 : 30000)
        return { ...row, attachments, estimate: row.estimate || estimateChange(row.title,row.description), ...progress }
      } catch { return { ...row, attachments, status: 'status_unavailable' } }
    }))
    return Response.json({ requests: requests.map(row => requestForViewer(row, canViewLinks)), isAdmin, canViewRepositoryLinks: canViewLinks }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return requestError(error) }
}
