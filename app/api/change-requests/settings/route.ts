import { requestContext, requestAdmin, requestError } from '@/lib/change-requests-server'
import { spendingPolicy } from '@/lib/change-request-estimates-server'
export async function GET() {
  try { const {isAdmin}=await requestContext(); if (!isAdmin) return Response.json({error:'Administrator only.'},{status:403}); return Response.json({autoApproveUsd:await spendingPolicy()},{headers:{'Cache-Control':'no-store'}}) } catch(error) { return requestError(error) }
}
export async function POST(request:Request) {
  try {
    const {isAdmin}=await requestContext(request)
    if (!isAdmin) return Response.json({error:'Administrator only.'},{status:403})
    const text=await request.text(); if(text.length>200) throw new Error('Invalid policy.')
    const {autoApproveUsd}=JSON.parse(text)
    if(typeof autoApproveUsd!=='number' || !Number.isFinite(autoApproveUsd) || autoApproveUsd<0 || autoApproveUsd>100 || Math.abs(Math.round(autoApproveUsd*100)-autoApproveUsd*100)>0.00000001) throw new Error('Enter a dollar amount from 0 to 100 with at most two decimals.')
    const {error}=await requestAdmin().from('development_spending_policy').update({auto_approve_usd:autoApproveUsd}).eq('id',1)
    if(error) throw new Error('Unable to save spending policy. Check the cost-estimates migration.')
    return Response.json({autoApproveUsd})
  }catch(error){return requestError(error)}
}
