import {test} from 'node:test'
import assert from 'node:assert/strict'
import {estimateChange,tokenCost,mayAutoApprove} from '../lib/change-request-cost.ts'
import {readUsage} from '../scripts/development/usage.mjs'
test('cost includes cached input once and rejects invalid usage',()=>{
 assert.equal(tokenCost(1000000,0,1000000),5.25)
 assert.equal(tokenCost(1000000,1000000,0),0.075)
 assert.throws(()=>tokenCost(10,11,0));assert.throws(()=>tokenCost(-1,0,0))
})
test('only explicit admin acceptance authorizes eligible work',()=>{
 const small=estimateChange('Welcome heading','Add a welcome heading to the account page.')
 assert.equal(mayAutoApprove(true,false,small),false)
 assert.equal(mayAutoApprove(true,true,small),true)
 assert.equal(mayAutoApprove(false,true,small),false)
 assert.equal(mayAutoApprove(false,false,small),false)
 assert.equal(mayAutoApprove(true,true,estimateChange('Schema change','Add a database schema migration for this feature.')),false)
})
test('usage aggregates completion events and ignores embedded agent text',()=>{
 const event='{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":50,"output_tokens":20}}'
 const usage=readUsage(`2026-10-14T20:00:00Z ${event}\n${event}\n{"type":"item.completed","item":{"text":${JSON.stringify(event)}}}`)
 assert.deepEqual(usage,{input:200,cached:100,output:40,turns:2,valid:true})
 assert.equal(readUsage('no completion').valid,false)
 assert.equal(readUsage('{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":2,"output_tokens":0}}').valid,false)
})

test('accepted estimate is bound to user, exact content, expiry and pricing',async()=>{
 const {signCostEstimate,verifyCostEstimate}=await import('../lib/change-request-signing.ts')
 const e=estimateChange('Welcome heading','Add a welcome heading to the account page.')
 const token=signCostEstimate('test-key','owner','Welcome heading','Description',e,1000)
 assert.deepEqual(verifyCostEstimate('test-key',token,'owner','Welcome heading','Description',e,1001),e)
 assert.throws(()=>verifyCostEstimate('test-key',token,'another-user','Welcome heading','Description',e,1001))
 assert.throws(()=>verifyCostEstimate('test-key',token,'owner','Edited title','Description',e,1001))
 assert.throws(()=>verifyCostEstimate('test-key',token,'owner','Welcome heading','Description',e,901001))
 assert.throws(()=>verifyCostEstimate('test-key',token+'0','owner','Welcome heading','Description',e,1001))
 assert.throws(()=>verifyCostEstimate('test-key',token,'owner','Welcome heading','Description',{...e,model:'other'},1001))
})
