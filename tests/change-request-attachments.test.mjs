import {test} from 'node:test'
import assert from 'node:assert/strict'
import {attachmentType,validateAttachmentBytes,attachmentIds,IMAGE_LIMIT,TEXT_LIMIT} from '../lib/change-request-attachments.ts'
import {estimateChange} from '../lib/change-request-cost.ts'
import {parseReferences,downloadReferences} from '../scripts/development/reference-files.mjs'
import {createHash} from 'node:crypto'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
const id='12345678-1234-4123-8123-123456789abc'
test('uploads restrict supported formats, sizes, bytes and attachment identifiers',()=>{
 assert.equal(attachmentType('screen.PNG',IMAGE_LIMIT).mime,'image/png')
 assert.throws(()=>attachmentType('screen.png',IMAGE_LIMIT+1));assert.throws(()=>attachmentType('notes.txt',TEXT_LIMIT+1));assert.throws(()=>attachmentType('script.exe',10));assert.throws(()=>attachmentType('empty.txt',0))
 assert.throws(()=>validateAttachmentBytes('image/png',Buffer.from('fake PNG')))
 assert.throws(()=>validateAttachmentBytes('text/plain',Buffer.from([0xff])))
 assert.throws(()=>validateAttachmentBytes('text/plain',Buffer.from([0])))
 assert.deepEqual(attachmentIds([id]),[id]);assert.throws(()=>attachmentIds([id,id]));assert.throws(()=>attachmentIds(['../../other-user']))
})
test('references reject foreign hosts, redirects targets, traversal schemes and oversized files',()=>{
 const ref={name:'notes.txt',mime:'text/plain',size:5,sha256:'a'.repeat(64),url:'https://ppewbycqxoixrxpggysm.supabase.co/storage/v1/object/sign/change-request-attachments/user/file?token=x'}
 const body=r=>`<!-- app-reference-files -->\n${JSON.stringify([r])}\n<!-- /app-reference-files -->`
 assert.equal(parseReferences(body(ref)).length,1)
 for(const bad of [{...ref,url:'https://attacker.example/file'},{...ref,url:'http://127.0.0.1/file'},{...ref,size:102401},{...ref,sha256:'fake'},{...ref,mime:'text/html'}])assert.throws(()=>parseReferences(body(bad)))
})
test('downloaded text is bounded and hashed before entering the model prompt',async()=>{
 const bytes=Buffer.from('Reference requirements'),directory=await mkdtemp(join(tmpdir(),'reference-test-'))
 const file={name:'notes.md',mime:'text/markdown',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),url:'https://ppewbycqxoixrxpggysm.supabase.co/storage/v1/object/sign/change-request-attachments/user/file?token=x'}
 const body=`<!-- app-reference-files -->${JSON.stringify([file])}<!-- /app-reference-files -->`
 const original=globalThis.fetch
 try{globalThis.fetch=async()=>new Response(bytes);const result=await downloadReferences(body,directory);assert.equal(result.texts[0].content,bytes.toString());assert.equal(await readFile(join(directory,'images.json'),'utf8'),'[]');globalThis.fetch=async()=>new Response(Buffer.from('different'));await assert.rejects(downloadReferences(body,directory))}finally{globalThis.fetch=original;await rm(directory,{recursive:true,force:true})}
})
test('attachment context increases the cost estimate',()=>{assert.ok(estimateChange('Heading update','Add a welcome heading.',8000).usd[1]>estimateChange('Heading update','Add a welcome heading.').usd[1])})
