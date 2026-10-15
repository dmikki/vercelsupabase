import {test} from 'node:test'
import assert from 'node:assert/strict'
import {canViewRepositoryLinks,requestForViewer} from '../lib/change-request-access.ts'

test('repository links are restricted to the verified administrator email',()=>{
 assert.equal(canViewRepositoryLinks({email:'durga1@gmail.com',email_confirmed_at:'2026-01-01'}),true)
 assert.equal(canViewRepositoryLinks({email:'DURGA1@gmail.com',email_confirmed_at:'2026-01-01'}),true)
 assert.equal(canViewRepositoryLinks({email:'another@example.com',email_confirmed_at:'2026-01-01'}),false)
 assert.equal(canViewRepositoryLinks({email:'durga1@gmail.com'}),false)
 assert.equal(canViewRepositoryLinks({}),false)
})
test('non-admin request responses omit GitHub URLs and issue numbers while retaining status',()=>{
 const request={id:'request',title:'Change',status:'deployed',github_issue_number:17,issue_url:'https://github.com/private/issues/17',pr_url:'https://github.com/private/pull/18'}
 assert.deepEqual(requestForViewer(request,false),{id:'request',title:'Change',status:'deployed'})
 assert.deepEqual(requestForViewer(request,true),request)
 assert.equal(request.github_issue_number,17)
 assert.deepEqual(requestForViewer({status:'saved'},false),{status:'saved'})
})
