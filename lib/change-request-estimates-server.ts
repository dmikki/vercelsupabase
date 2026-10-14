import 'server-only'
import {signCostEstimate,verifyCostEstimate} from './change-request-signing'
import { requestAdmin } from './change-requests-server'
import { estimateChange } from './change-request-cost'
function signingKey() {
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY
  if(!key) throw Error('Estimate signing is not configured.')
  return key
}
export function signEstimate(user:string,title:string,description:string) {
  return signCostEstimate(signingKey(),user,title,description,estimateChange(title,description))
}
export function verifyEstimate(token:unknown,user:string,title:string,description:string) {
  return verifyCostEstimate(signingKey(),token,user,title,description,estimateChange(title,description))
}
export async function spendingPolicy() {
  const {data,error} = await requestAdmin().from('development_spending_policy').select('auto_approve_usd').eq('id',1).single()
  if (error) throw new Error('Apply the cost-estimates database migration before using this feature.')
  return Number(data.auto_approve_usd)
}
