import {estimateChange,MODEL,AUTO_APPROVAL_LIMIT_USD} from '../../lib/change-request-cost.ts'
import {parseReferences} from './reference-files.mjs'
export function automaticUpperEstimate(issue) {
 if(!issue?.body?.match(/<!-- app-request:[0-9a-f-]{36} -->/i))return null
 const body=issue.body,start=body.indexOf('## Requested change\n'),end=body.lastIndexOf('\n\n## Development process\n')
 if(start<0||end<=start)return null
 const title=issue.title.replace(/^\[App request\]\s*/,''),description=body.slice(start+'## Requested change\n'.length,end).trim()
 if(title.length<5||title.length>120||description.length<20||description.length>6000)return null
 try {
  const quote=JSON.parse(body.match(/## Estimated API cost\n([^\n]+)/)?.[1]||'null')
  const files=parseReferences(body)
  const reserve=files.reduce((n,f)=>n+(f.mime.startsWith('image/')?8000:Math.ceil(f.size/2)),0)
  const computed=estimateChange(title,description,reserve)
  if(!quote||quote.model!==MODEL||quote.version!==computed.version||!Array.isArray(quote.usd)||quote.usd[1]!==computed.usd[1]||computed.manualOnly)return null
  return computed.usd[1]<AUTO_APPROVAL_LIMIT_USD ? computed.usd[1] : null
 }catch{return null}
}
export function hasAutomaticApproval(check,head) {
 if(check?.name!=='Development CI'||check.app?.slug!=='github-actions'||check.head_sha!==head||check.status!=='completed'||check.conclusion!=='success')return false
 const line=check.output?.summary?.split('\n').find(s=>s.startsWith(`auto-merge:${head}:`))
 const amount=line?.slice(`auto-merge:${head}:`.length)
 return typeof amount==='string'&&/^\d+(\.\d+)?$/.test(amount)&&Number(amount)>=0&&Number(amount)<AUTO_APPROVAL_LIMIT_USD
}
