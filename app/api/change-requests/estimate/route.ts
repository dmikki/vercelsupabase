import { requestContext, requestError } from '@/lib/change-requests-server'
import { parseChangeRequest } from '@/lib/change-request-validation'
import { estimateChange, mayAutoApprove } from '@/lib/change-request-cost'
import { signEstimate, spendingPolicy } from '@/lib/change-request-estimates-server'
export async function POST(request: Request) {
  try {
    const {user,isAdmin} = await requestContext(request)
    const text = await request.text()
    if (text.length > 16000) throw new Error('Request is too large.')
    const input = parseChangeRequest(JSON.parse(text))
    const estimate = estimateChange(input.title,input.description)
    const threshold = await spendingPolicy()
    return Response.json({estimate,token:signEstimate(user.id,input.title,input.description),isAdmin,autoApproved:mayAutoApprove(isAdmin,true,estimate,threshold)}, {headers:{'Cache-Control':'no-store'}})
  } catch(error) { return requestError(error) }
}
