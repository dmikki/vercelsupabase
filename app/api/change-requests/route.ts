import { requestContext, requestAdmin, requestError } from '@/lib/change-requests-server'
import { ensureRequestIssue, github, type GitHubIssue, type GitHubPull } from '@/lib/development-github'
import { estimateChange, mayAutoApprove, tokenCost, MODEL } from '@/lib/change-request-cost'
import { verifyEstimate, spendingPolicy } from '@/lib/change-request-estimates-server'
import { parseChangeRequest } from '@/lib/change-request-validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const { supabase, user, isAdmin } = await requestContext(request)
    const body = await request.text()
    if (body.length > 50000) throw new Error('Request is too large.')
    const parsed = JSON.parse(body)
    const input = parseChangeRequest(parsed)
    const estimate = verifyEstimate(parsed.estimateToken,user.id,input.title,input.description)
    const autoApproved = mayAutoApprove(isAdmin,parsed.acceptEstimate === true,estimate,await spendingPolicy())
    const admin = requestAdmin()
    const { error } = await supabase.rpc('submit_change_request', {
      request_id: input.id, request_title: input.title, request_description: input.description,
    })
    if (error) throw new Error(error.message.includes('Daily request limit') ? 'Daily request limit reached (5 per day).' : 'Unable to save request. Check that the database migration has been applied.')
    const { data: row, error: readError } = await admin.from('change_requests').select('*').eq('id', input.id).eq('user_id', user.id).single()
    if (readError || !row) throw new Error('Unable to find your request.')
    if (row.title !== input.title || row.description !== input.description) throw new Error('Request ID already belongs to different content.')
    if (row.github_issue_number) return Response.json({ id: row.id, status: 'submitted' })
    // A lease prevents concurrent retries from publishing the same request.
    if (row.status === 'publishing' && Date.now() - new Date(row.updated_at).getTime() < 120000)
      return Response.json({ id: row.id, status: 'publishing' }, { status: 202 })
    const { data: claimed, error: claimError } = await admin.from('change_requests')
      .update({ estimate, auto_authorized: autoApproved || row.auto_authorized === true, status: 'publishing', updated_at: new Date().toISOString() })
      .eq('id', row.id).eq('updated_at', row.updated_at).select('id')
    if (claimError) throw new Error('Unable to reserve request for publication.')
    if (!claimed?.length) return Response.json({ id: row.id, status: 'publishing' }, { status: 202 })
    try {
      const issue = await ensureRequestIssue({ ...row, estimate }, autoApproved || row.auto_authorized === true)
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

export async function GET() {
  try {
    const { supabase, isAdmin } = await requestContext()
    const { data, error } = await (isAdmin ? requestAdmin() : supabase).from('change_requests')
      .select('id,title,description,status,github_issue_number,created_at,estimate').order('created_at', { ascending: false }).limit(10)
    if (error) throw new Error('Unable to load requests. Check that the database migration has been applied.')
    const requests = await Promise.all((data || []).map(async row => {
      if (!row.github_issue_number) return row
      try {
        const issue = await github<GitHubIssue>(`/issues/${row.github_issue_number}`)
        const labels = issue.labels.map(label => label.name)
        let status = labels.includes('codex-failed') ? 'failed' : labels.includes('codex-running') ? 'implementing' : labels.includes('codex-ready') ? 'review' : labels.includes('codex-approved') ? 'queued' : 'awaiting_authorization'
        const comments = await github<{ body: string; user: { login: string; type: string } }[]>(`/issues/${issue.number}/comments?per_page=100`)
        const prNumber = comments.map(c => c.body.match(/^\[app-request-pr\] #(\d+)$/m)?.[1]).filter(Boolean).at(-1)
        let prUrl: string | undefined
        if (prNumber) {
          const pr = await github<GitHubPull>(`/pulls/${prNumber}`)
          prUrl = pr.html_url
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
        const usage = [...usageRuns.values()]
        return { ...row, estimate: row.estimate || estimateChange(row.title,row.description), usage, status, issue_url: issue.html_url, pr_url: prUrl }
      } catch { return { ...row, status: 'status_unavailable' } }
    }))
    return Response.json({ requests, isAdmin }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return requestError(error) }
}
