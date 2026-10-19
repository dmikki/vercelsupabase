import test from 'node:test'
import assert from 'node:assert/strict'
import { verifyDeployment } from '../scripts/development/verify-deployment.mjs'

const sha = 'a'.repeat(40)
const site = (overrides = {}) => async url => {
  const path = new URL(url).pathname
  const info = { version: sha, environment: 'preview', supabaseHost: 'staging.supabase.co', supabaseReachable: true, ...overrides.info }
  if (path === '/api/version') return Response.json(info, { status: overrides.versionStatus || 200 })
  if (path === '/login') return new Response('<form></form>', { status: 200 })
  if (path === '/account') return new Response(null, { status: 307, headers: { location: '/login' } })
  if (path === '/api/change-requests') return Response.json({ error: 'login' }, { status: overrides.apiStatus || 401 })
  return new Response(null, { status: 404 })
}
const options = (overrides = {}) => ({ baseUrl: 'https://preview.example', expectedSha: sha, expectedEnvironment: 'preview', productionHost: 'prod.supabase.co', attempts: 2, delayMs: 0, pause: async () => {}, fetchImpl: site(overrides), ...overrides.options })

test('a healthy preview on staging passes every check', async () => {
  const result = await verifyDeployment(options())
  assert.equal(result.ok, true, JSON.stringify(result.checks))
  assert.equal(result.checks.length, 7)
})

test('a preview wired to the production database fails', async () => {
  const result = await verifyDeployment(options({ info: { supabaseHost: 'prod.supabase.co' } }))
  assert.equal(result.ok, false)
  assert.match(result.checks.find(check => !check.ok).detail, /PRODUCTION DATABASE/)
})

test('isolation cannot be proven without knowing the production database', async () => {
  const result = await verifyDeployment(options({ options: { productionHost: '' } }))
  assert.equal(result.ok, false)
  assert.match(result.checks.find(check => !check.ok).detail, /PRODUCTION_SUPABASE_URL/)
})

test('the wrong commit or environment fails', async () => {
  assert.equal((await verifyDeployment(options({ info: { version: 'b'.repeat(40) } }))).ok, false)
  assert.equal((await verifyDeployment(options({ info: { environment: 'production' } }))).ok, false)
})

test('an unreachable database or an exposed API fails', async () => {
  assert.equal((await verifyDeployment(options({ info: { supabaseReachable: false } }))).ok, false)
  assert.equal((await verifyDeployment(options({ apiStatus: 200 }))).ok, false)
})

test('deployment protection is reported with the remedy', async () => {
  const result = await verifyDeployment(options({ versionStatus: 401 }))
  assert.equal(result.ok, false)
  assert.match(result.checks[0].detail, /VERCEL_AUTOMATION_BYPASS_SECRET/)
})

test('production verification checks the production database host', async () => {
  const result = await verifyDeployment(options({ info: { environment: 'production', supabaseHost: 'prod.supabase.co' }, options: { expectedEnvironment: 'production' } }))
  assert.equal(result.ok, true)
  assert.equal((await verifyDeployment(options({ info: { environment: 'production', supabaseHost: 'staging.supabase.co' }, options: { expectedEnvironment: 'production' } }))).ok, false)
})
