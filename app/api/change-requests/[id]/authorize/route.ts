import {requestAttachments,attachmentContext,refreshIssueReferences} from '@/lib/change-request-attachments-server'
import { requestContext, requestAdmin, requestError } from '@/lib/change-requests-server'
import { verifyEstimate } from '@/lib/change-request-estimates-server'
import { forget, github, issueProgressKey, queueRequestIssue, type GitHubIssue } from '@/lib/development-github'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { isAdmin, user } = await requestContext(request)
    if (!isAdmin) return Response.json({ error: 'Only the administrator can start implementation.' }, { status: 403 })
    const { id } = await params
    const { data: row, error } = await requestAdmin().from('change_requests').select('github_issue_number,title,description,kind').eq('id', id).single()
    if (error || !row?.github_issue_number) throw new Error('Publish the request to GitHub first.')
    const body = await request.text(); if(body.length>40000) throw new Error('Invalid estimate.')
    const accepted=JSON.parse(body)
    const files=await requestAttachments(id)
    const estimate=verifyEstimate(accepted.estimateToken,user.id,row.title,row.description,attachmentContext(files,row.kind))
    if(accepted.acceptEstimate!==true || estimate.manualOnly) throw new Error('Approve the estimate for an eligible request first.')
    const {error:saveError}=await requestAdmin().from('change_requests').update({estimate}).eq('id',id)
    if(saveError) throw new Error('Unable to save estimate.')
    await refreshIssueReferences(row.github_issue_number,files)
    // Labels are provisioned as part of setup; repeated authorization is idempotent.
    await queueRequestIssue(await github<GitHubIssue>(`/issues/${row.github_issue_number}`),true)
    forget(issueProgressKey(row.github_issue_number))
    return Response.json({ status: 'queued' })
  } catch (error) { return requestError(error) }
}
