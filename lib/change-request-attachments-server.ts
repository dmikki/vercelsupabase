import 'server-only'
import {github,type GitHubIssue} from './development-github'
import {requestAdmin} from './change-requests-server'
import {ATTACHMENT_BUCKET,attachmentIds,type RequestAttachment} from './change-request-attachments'
export async function ownedAttachments(user:string,ids:unknown,requestId?:string) {
  const selected=attachmentIds(ids)
  if(!selected.length)return [] as RequestAttachment[]
  const {data,error}=await requestAdmin().from('change_request_attachments').select('id,name,mime,size,sha256,storage_path,request_id').eq('user_id',user).eq('ready',true).in('id',selected).order('id')
  if(error||data?.length!==selected.length||data.some(row=>row.request_id && row.request_id!==requestId)) throw Error('Unable to use these attachments. Check ownership and the attachments migration.')
  return data as RequestAttachment[]
}
export function attachmentContext(files:RequestAttachment[],kind:string) {
  return JSON.stringify({kind,files:files.map(({id,name,mime,size,sha256})=>({id,name,mime,size,sha256}))})
}
export async function referenceManifest(files:RequestAttachment[]) {
  return Promise.all(files.map(async file=>{
    const {data,error}=await requestAdmin().storage.from(ATTACHMENT_BUCKET).createSignedUrl(file.storage_path,86400)
    if(error||!data) throw Error('Unable to prepare reference attachments.')
    return {name:file.name,mime:file.mime,size:file.size,sha256:file.sha256,url:data.signedUrl}
  }))
}
export async function requestAttachments(requestId:string) {
 const {data,error}=await requestAdmin().from('change_request_attachments').select('id,name,mime,size,sha256,storage_path,request_id').eq('request_id',requestId).eq('ready',true).order('id')
 if(error) throw Error('Apply the attachments migration.')
 return (data||[]) as RequestAttachment[]
}

export async function refreshIssueReferences(number:number,files:RequestAttachment[]) {
 const issue=await github<GitHubIssue & {body:string}>(`/issues/${number}`)
 const clean=issue.body.replace(/\n<!-- app-reference-files -->[\s\S]*?<!-- \/app-reference-files -->/g,'')
 await github(`/issues/${number}`,{method:'PATCH',body:JSON.stringify({body:clean+`\n<!-- app-reference-files -->\n${JSON.stringify(await referenceManifest(files))}\n<!-- /app-reference-files -->`})})
}
