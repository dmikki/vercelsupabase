import {createHash} from 'node:crypto'
import {mkdir,writeFile} from 'node:fs/promises'
const types={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','text/plain':'txt','text/markdown':'md','text/csv':'csv','application/json':'json'}
export function parseReferences(body,origin='https://ppewbycqxoixrxpggysm.supabase.co') {
 const match=body.match(/<!-- app-reference-files -->\s*([^]*?)\s*<!-- \/app-reference-files -->/)
 if(!match)return []
 if(match[1].length>20000)throw Error('Reference manifest too large')
 const files=JSON.parse(match[1])
 if(!Array.isArray(files)||files.length>5)throw Error('Invalid reference manifest')
 for(const f of files) {
  const url=new URL(f.url)
  if(url.origin!==origin||!url.pathname.startsWith('/storage/v1/object/sign/change-request-attachments/')||url.username||url.password||!types[f.mime]||!Number.isSafeInteger(f.size)||f.size<=0||f.size>(f.mime.startsWith('image/')?2097152:102400)||!/^[0-9a-f]{64}$/.test(f.sha256)||typeof f.name!=='string'||f.name.length>120)throw Error('Invalid reference file')
 }
 return files
}
export async function downloadReferences(body,directory) {
 const files=parseReferences(body),images=[],texts=[]
 await mkdir(directory,{recursive:true})
 for(let i=0;i<files.length;i++) {
  const f=files[i],response=await fetch(f.url,{redirect:'error',signal:AbortSignal.timeout(20000)})
  if(!response.ok||!response.body)throw Error('Reference unavailable or expired. Ask the owner to renew attachment links before retrying.')
  const reader=response.body.getReader(),chunks=[];let size=0
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>f.size){await reader.cancel();throw Error('Reference exceeds declared size')}chunks.push(value)}
  const bytes=Buffer.concat(chunks)
  if(size!==f.size||createHash('sha256').update(bytes).digest('hex')!==f.sha256)throw Error('Reference integrity check failed')
  const name=`reference-${i+1}.${types[f.mime]}`
  if(f.mime.startsWith('image/')){await writeFile(`${directory}/${name}`,bytes);images.push(name)}
  else {const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);texts.push({name:f.name,content:text})}
 }
 await writeFile(`${directory}/images.json`,JSON.stringify(images))
 return {images,texts}
}
