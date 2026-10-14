import test from 'node:test'
import assert from 'node:assert/strict'
import { parseChangeRequest, sameOrigin } from '../lib/change-request-validation.ts'
const valid={id:'12345678-1234-4123-8123-123456789abc',title:'Add dark mode',description:'Add a toggle that switches the profile page to dark mode.'}
test('request input enforces ID, type, and size boundaries', () => {
  assert.equal(parseChangeRequest(valid).title,'Add dark mode')
  for (const bad of [null,{}, {...valid,id:'../main'}, {...valid,title:'a'}, {...valid,description:'x'}, {...valid,description:'x'.repeat(6001)}]) assert.throws(()=>parseChangeRequest(bad))
})
test('origin checks support localhost and proxied HTTPS while rejecting foreign or missing origins', () => {
  assert.equal(sameOrigin('http://127.0.0.1:3000','127.0.0.1:3000','http'),true)
  assert.equal(sameOrigin('https://app.example.com','app.example.com','https'),true)
  assert.equal(sameOrigin('https://attacker.example','app.example.com','https'),false)
  assert.equal(sameOrigin('http://app.example.com','app.example.com','https'),false)
  assert.equal(sameOrigin(null,'app.example.com','https'),false)
})
