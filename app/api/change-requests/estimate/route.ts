import { ownedAttachments, attachmentContext } from '@/lib/change-request-attachments-server'
import { requestContext, requestAdmin, requestError } from '@/lib/change-requests-server'
import { parseChangeRequest } from '@/lib/change-request-validation'
import { mayAutoApprove } from '@/lib/change-request-cost'
import { signEstimate, estimateWithReferences } from '@/lib/change-request-estimates-server'
export async function POST(request: Request) {
  try {
    const {user,isAdmin} = await requestContext(request)
    const text = await request.text()
    if (text.length > 16000) throw new Error('Request is too large.')
    const parsed=JSON.parse(text)
    const input = parseChangeRequest(parsed)
    let owner=user.id
    if(isAdmin) {
      const {data:existing}=await requestAdmin().from('change_requests').select('user_id,title,description,kind').eq('id',input.id).maybeSingle()
      if(existing&&existing.user_id!==user.id) {
        if(existing.title!==input.title||existing.description!==input.description||existing.kind!==input.kind)throw Error('The submitted request changed. Refresh before estimating.')
        owner=existing.user_id
      }
    }
    const files=await ownedAttachments(owner,parsed.attachments,input.id)
    if(owner!==user.id&&files.some(file=>file.request_id!==input.id))throw Error('Only submitted request attachments can be estimated by an administrator.')
    const context=attachmentContext(files,input.kind)
    const estimate = estimateWithReferences(input.title,input.description,context)
    return Response.json({estimate,token:signEstimate(user.id,input.title,input.description,context),isAdmin,autoApproved:mayAutoApprove(isAdmin,true,estimate)}, {headers:{'Cache-Control':'no-store'}})
  } catch(error) { return requestError(error) }
}
