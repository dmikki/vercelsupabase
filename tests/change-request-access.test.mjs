import {test} from 'node:test'
import assert from 'node:assert/strict'
import {canViewRepositoryLinks,requestForViewer} from '../lib/change-request-access.ts'

test('repository links are restricted to administrators with a confirmed email',()=>{
 assert.equal(canViewRepositoryLinks({email_confirmed_at:'2026-01-01'},true),true)
 assert.equal(canViewRepositoryLinks({email_confirmed_at:'2026-01-01'},false),false)
 assert.equal(canViewRepositoryLinks({},true),false)
 assert.equal(canViewRepositoryLinks({},false),false)
})
test('non-admin request responses omit GitHub URLs and issue numbers while retaining status',()=>{
 const request={id:'request',title:'Change',status:'deployed',github_issue_number:17,issue_url:'https://github.com/private/issues/17',pr_url:'https://github.com/private/pull/18'}
 assert.deepEqual(requestForViewer(request,false),{id:'request',title:'Change',status:'deployed'})
 assert.deepEqual(requestForViewer(request,true),request)
 assert.equal(request.github_issue_number,17)
 assert.deepEqual(requestForViewer({status:'saved'},false),{status:'saved'})
})

test('release readiness and production results are visible only to administrators', async () => {
  const { requestForViewer } = await import('../lib/change-request-access.ts')
  const request = { id: 'a', status: 'review', pr_url: 'https://example.test/pull/1', readiness: { verdict: 'ready' }, production: { ok: true } }
  assert.deepEqual(requestForViewer(request, false), { id: 'a', status: 'review' })
  assert.equal(requestForViewer(request, true).readiness.verdict, 'ready')
})
