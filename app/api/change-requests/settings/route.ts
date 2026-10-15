import { requestContext, requestError } from '@/lib/change-requests-server'
import { spendingPolicy } from '@/lib/change-request-estimates-server'
export async function GET() {
  try { const {isAdmin}=await requestContext(); if (!isAdmin) return Response.json({error:'Administrator only.'},{status:403}); return Response.json({autoApproveUsd:await spendingPolicy()},{headers:{'Cache-Control':'no-store'}}) } catch(error) { return requestError(error) }
}
export async function POST(request:Request) {
  try {
    const {isAdmin}=await requestContext(request)
    if(!isAdmin)return Response.json({error:'Administrator only.'},{status:403})
    return Response.json({error:'Only administrators can start implementation, and every merge requires owner approval. Policy changes require a repository configuration change.'},{status:409})
  }catch(error){return requestError(error)}
}
