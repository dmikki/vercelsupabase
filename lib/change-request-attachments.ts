export const ATTACHMENT_BUCKET = 'change-request-attachments'
export const MAX_ATTACHMENTS = 5
export const IMAGE_LIMIT = 2 * 1024 * 1024
export const TEXT_LIMIT = 100 * 1024
export const ATTACHMENT_TYPES: Record<string,string> = {png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',txt:'text/plain',md:'text/markdown',csv:'text/csv',json:'application/json'}
export function attachmentType(name:string,size:number) {
  const extension=name.split('.').at(-1)?.toLowerCase() || ''
  const mime=ATTACHMENT_TYPES[extension]
  if(!mime) throw Error('Use PNG, JPG, WebP, TXT, MD, CSV or JSON files.')
  if(!Number.isSafeInteger(size)||size<=0||size>(mime.startsWith('image/')?IMAGE_LIMIT:TEXT_LIMIT)) throw Error('Images must be at most 2 MB; text files at most 100 KB.')
  return {extension,mime}
}
export function validateAttachmentBytes(mime:string,bytes:Uint8Array) {
  const b=Buffer.from(bytes)
  const valid=mime==='image/png'?b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):mime==='image/jpeg'?b[0]===255&&b[1]===216&&b[2]===255:mime==='image/webp'?b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP':true
  if(!valid) throw Error('The file contents do not match the image type.')
  if(!mime.startsWith('image/')) { try {new TextDecoder('utf-8',{fatal:true}).decode(b)} catch{throw Error('Text attachments must use UTF-8 encoding.')} if(b.includes(0)) throw Error('Binary files are not supported as text.') }
}
export function attachmentIds(value:unknown) {
  if(value===undefined) return [] as string[]
  if(!Array.isArray(value)||value.length>MAX_ATTACHMENTS||value.some(id=>typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))||new Set(value).size!==value.length) throw Error('Invalid attachments.')
  return value as string[]
}
export type RequestAttachment = {id:string;name:string;mime:string;size:number;sha256:string;storage_path:string;request_id:string|null}
