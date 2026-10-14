import {randomUUID,createHash} from 'node:crypto'
import {requestContext,requestAdmin,requestError} from '@/lib/change-requests-server'
import {ATTACHMENT_BUCKET,attachmentType,validateAttachmentBytes} from '@/lib/change-request-attachments'
export async function POST(request:Request) {
 try {
  const {user}=await requestContext(request)
  if(Number(request.headers.get('content-length'))>2300000) throw Error('Images must be at most 2 MB.')
  const form=await request.formData(), file=form.get('file'), draft=form.get('draftId')
  if(!(file instanceof File)||typeof draft!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(draft)) throw Error('Invalid upload.')
  const {extension,mime}=attachmentType(file.name,file.size)
  const bytes=Buffer.from(await file.arrayBuffer());validateAttachmentBytes(mime,bytes)
  const admin=requestAdmin(),id=randomUUID(),path=`${user.id}/${draft}/${id}.${extension}`
  const name=file.name.replace(/[\x00-\x1f\x7f]/g,'').slice(0,120)||`reference.${extension}`
  const sha256=createHash('sha256').update(bytes).digest('hex')
  // The RPC reserves quota before storage upload, under a per-user database lock.
  const {error}=await admin.rpc('reserve_change_attachment',{attachment_id:id,actor:user.id,draft_id:draft,file_name:name,file_mime:mime,file_size:file.size,file_path:path,file_hash:sha256})
  if(error) throw Error('Upload limit reached or attachments storage is not configured (5 files per draft, 25 per day).')
  const {error:uploadError}=await admin.storage.from(ATTACHMENT_BUCKET).upload(path,bytes,{contentType:mime,upsert:false})
  if(uploadError){await admin.from('change_request_attachments').delete().eq('id',id);throw Error('Unable to upload attachment. Check the private storage bucket.')}
  const {error:readyError}=await admin.from('change_request_attachments').update({ready:true}).eq('id',id)
  if(readyError){await admin.storage.from(ATTACHMENT_BUCKET).remove([path]);await admin.from('change_request_attachments').delete().eq('id',id);throw Error('Unable to finalize attachment.')}
  const {data}=await admin.storage.from(ATTACHMENT_BUCKET).createSignedUrl(path,3600)
  return Response.json({attachment:{id,name,mime,size:file.size,url:data?.signedUrl}},{status:201})
 }catch(error){return requestError(error)}
}
export async function DELETE(request:Request) {
 try {
  const {user}=await requestContext(request),{id}=await request.json()
  const admin=requestAdmin()
  const {data:row,error}=await admin.from('change_request_attachments').select('storage_path,request_id').eq('id',id).eq('user_id',user.id).single()
  if(error||!row||row.request_id) throw Error('Only your unsubmitted attachments can be removed.')
  const {data:claimed,error:claimError}=await admin.from('change_request_attachments').update({ready:false,removed:true}).eq('id',id).eq('user_id',user.id).is('request_id',null).eq('ready',true).select('id')
  if(claimError||!claimed?.length) throw Error('This attachment has already been submitted or removed.')
  const {error:removeError}=await admin.storage.from(ATTACHMENT_BUCKET).remove([row.storage_path]);if(removeError)throw Error('Unable to remove attachment.')
  return Response.json({removed:true})
 }catch(error){return requestError(error)}
}
