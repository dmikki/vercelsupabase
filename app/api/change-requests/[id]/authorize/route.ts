import { requestContext, requestAdmin, requestError } from '@/lib/change-requests-server'
import { github } from '@/lib/development-github'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { isAdmin } = await requestContext(request)
    if (!isAdmin) return Response.json({ error: 'Only the administrator can start implementation.' }, { status: 403 })
    const { id } = await params
    const { data: row, error } = await requestAdmin().from('change_requests').select('github_issue_number').eq('id', id).single()
    if (error || !row?.github_issue_number) throw new Error('Publish the request to GitHub first.')
    // Labels are provisioned as part of setup; repeated authorization is idempotent.
    await github(`/issues/${row.github_issue_number}/labels`, { method: 'POST', body: JSON.stringify({ labels: ['codex-approved'] }) })
    return Response.json({ status: 'queued' })
  } catch (error) { return requestError(error) }
}
