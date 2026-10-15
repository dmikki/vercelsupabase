import test from 'node:test'
import assert from 'node:assert/strict'
import { allowedPath, approvalSha, checksPass, forbiddenAddition } from '../scripts/development/policy.mjs'

test('code generation cannot replace automation, migrations, secrets, or traversal paths', () => {
  for (const p of ['.github/workflows/ci.yml','supabase/migrations/delete.sql','package.json','scripts/development/approve.mjs','app/api/change-requests/route.ts','lib/change-requests-server.ts','app/../.env','app/.env','app/components/release-updater.tsx','app/api/change-requests/attachments/route.ts','lib/change-request-attachments.ts']) assert.equal(allowedPath(p),false,p)
  assert.equal(allowedPath('app/components/dark-mode.tsx'),true)
  assert.equal(allowedPath('lib/profile.ts'),true)
  assert.equal(allowedPath('app/components/dashboard-shell.tsx'),true)
})
test('code generation cannot add server endpoints anywhere', () => {
  for (const p of ['app/api/health/route.ts','app/api/new.ts','app/status/route.ts','app/feed/route.js','lib/proxy.ts','app/middleware.ts']) assert.equal(allowedPath(p),false,p)
})
test('generated code cannot read secrets, add server actions, or import privileged modules', () => {
  for (const line of ['+const k = process.env.SUPABASE_SERVICE_ROLE_KEY','+const e = process["env"]',"+'use server'",'+import { requestAdmin } from "@/lib/change-requests-server"',"+import { github } from '@/lib/development-github'","+import { createClient } from '@supabase/supabase-js'"])
    assert.notEqual(forbiddenAddition(`diff --git a/app/x.tsx b/app/x.tsx\n+++ b/app/x.tsx\n${line}`),null,line)
  assert.equal(forbiddenAddition('+++ b/app/x.tsx\n-const k = process.env.X\n+<h1>Welcome</h1>'),null)
})
test('approval must contain the entire exact commit', () => {
  assert.equal(approvalSha('/approve abc123'),null)
  assert.equal(approvalSha('please /approve '+ 'a'.repeat(40)),null)
  assert.equal(approvalSha('/approve '+ 'a'.repeat(40)),'a'.repeat(40))
})
test('merge needs current-head CI, current-base validation, and a successful Vercel check', () => {
  const head='a'.repeat(40),base='b'.repeat(40)
  const ci={name:'Development CI',app:{slug:'github-actions'},head_sha:head,status:'completed',conclusion:'success',output:{summary:`base:${base}`}}
  const vercel={context:'Vercel',creator:{login:'vercel[bot]'},state:'success'}
  assert.equal(checksPass([ci],[vercel],'Development CI',head,base),true)
  assert.equal(checksPass([ci],[],'Development CI',head,base),false)
  assert.equal(checksPass([{...ci,conclusion:'failure'}],[vercel],'Development CI',head,base),false)
  assert.equal(checksPass([ci],[vercel],'Development CI',head,'c'.repeat(40)),false)
  assert.equal(checksPass([ci],[{...vercel,state:'pending'}],'Development CI',head,base),false)
  assert.equal(checksPass([ci],[{...vercel,creator:{login:'someone'}}],'Development CI',head,base),false)
})
