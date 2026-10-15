import 'server-only'
import {signCostEstimate,verifyCostEstimate} from './change-request-signing'
import { estimateChange, AUTO_APPROVAL_LIMIT_USD } from './change-request-cost'
export function estimateWithReferences(title:string,description:string,context='') {
  const files=context ? JSON.parse(context).files || [] : []
  const reserve=files.reduce((n:number,f:{mime:string;size:number})=>n+(f.mime.startsWith('image/')?8000:Math.ceil(f.size/2)),0)
  return estimateChange(title,description,reserve)
}
function signingKey() {
  const key=process.env.ESTIMATE_SIGNING_SECRET
  if(!key||key.length<32) throw Error('Estimate signing is not configured.')
  return key
}
export function signEstimate(user:string,title:string,description:string,context='') {
  return signCostEstimate(signingKey(),user,title,description+context,estimateWithReferences(title,description,context))
}
export function verifyEstimate(token:unknown,user:string,title:string,description:string,context='') {
  return verifyCostEstimate(signingKey(),token,user,title,description+context,estimateWithReferences(title,description,context))
}
export async function spendingPolicy() {
  return AUTO_APPROVAL_LIMIT_USD
}
