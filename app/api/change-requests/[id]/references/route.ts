import {requestContext,requestAdmin,requestError} from '@/lib/change-requests-server'
import {requestAttachments,refreshIssueReferences} from '@/lib/change-request-attachments-server'
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
 try {
  const {isAdmin}=await requestContext(request)
  if(!isAdmin)return Response.json({error:'Administrator only.'},{status:403})
  const {id}=await params
  const {data:row,error}=await requestAdmin().from('change_requests').select('github_issue_number').eq('id',id).single()
  if(error||!row?.github_issue_number)throw Error('Publish the request first.')
  await refreshIssueReferences(row.github_issue_number,await requestAttachments(id))
  return Response.json({renewed:true})
 }catch(error){return requestError(error)}
}
