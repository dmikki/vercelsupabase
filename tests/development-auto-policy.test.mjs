import {test} from 'node:test'
import assert from 'node:assert/strict'
import {automaticUpperEstimate,hasAutomaticApproval} from '../scripts/development/auto-policy.mjs'
import {estimateChange} from '../lib/change-request-cost.ts'
const title='Change request icon',description='Change the visible request button icon to a heart.'
function issue(quote=estimateChange(title,description),text=description,files=[]) {return {title:`[App request] ${title}`,body:`<!-- app-request:12345678-1234-4123-8123-123456789abc -->\n<!-- app-reference-files -->\n${JSON.stringify(files)}\n<!-- /app-reference-files -->\n## Estimated API cost\n${JSON.stringify(quote)}\n\n## Requested change\n${text}\n\n## Development process\nAuthorization recorded.`}}
test('automatic merge recomputes the quoted estimate from request and references',()=>{
 assert.equal(automaticUpperEstimate(issue()),estimateChange(title,description).usd[1])
 assert.equal(automaticUpperEstimate(issue({...estimateChange(title,description),usd:[0,0.01]})),null)
 const complex='Change the authentication permissions and database schema.'
 assert.equal(automaticUpperEstimate(issue(estimateChange(title,complex),complex)),null)
 const files=Array.from({length:5},(_,i)=>({name:`ref${i}.txt`,mime:'text/plain',size:100000,sha256:'a'.repeat(64),url:`https://ppewbycqxoixrxpggysm.supabase.co/storage/v1/object/sign/change-request-attachments/user/${i}?token=x`}))
 const medium='Update the dashboard request icon using the supplied references.'
 assert.equal(automaticUpperEstimate(issue(estimateChange(title,medium,250000),medium,files)),null)
})
test('only successful GitHub Actions CI on the exact commit can attest below-$1 approval',()=>{
 const head='a'.repeat(40),check={name:'Development CI',app:{slug:'github-actions'},head_sha:head,status:'completed',conclusion:'success',output:{summary:`base:${'b'.repeat(40)}\nauto-merge:${head}:0.2175`}}
 assert.equal(hasAutomaticApproval(check,head),true)
 assert.equal(hasAutomaticApproval({...check,app:{slug:'other'}},head),false)
 assert.equal(hasAutomaticApproval({...check,conclusion:'failure'},head),false)
 assert.equal(hasAutomaticApproval(check,'c'.repeat(40)),false)
 for(const amount of ['1','1.01','-1','','NaN'])assert.equal(hasAutomaticApproval({...check,output:{summary:`auto-merge:${head}:${amount}`}},head),false)
})
