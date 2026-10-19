import test from 'node:test'
import assert from 'node:assert/strict'

process.env.GITHUB_REPOSITORY = 'o/r'
const { stageDatabase } = await import('../scripts/development/preview-gate.mjs')

const env = { STAGING_DATABASE_URL: 'postgres://staging', STAGING_SUPABASE_URL: 'https://s.supabase.co', STAGING_SUPABASE_PUBLISHABLE_KEY: 'p', STAGING_SUPABASE_SERVICE_ROLE_KEY: 's', SKIP_MIGRATION_FETCH: '1' }
const migrations = ['supabase/migrations/20261016000000_add_notes.sql']
const recorder = (failures = {}) => {
  const calls = []
  const exec = (command, args) => {
    const key = [command, args[0], args[1]].join(' ')
    calls.push(key)
    const name = Object.keys(failures).find(candidate => key.includes(candidate))
    if (name && (failures[name] === true || failures[name] > 0)) {
      if (failures[name] !== true) failures[name]--
      return { ok: false, output: `${name} failed` }
    }
    return { ok: true, output: '' }
  }
  return { calls, exec }
}

test('without migrations staging is still brought up to main and tested, with no migration fetch', () => {
  const { calls, exec } = recorder()
  assert.equal(stageDatabase({ migrations: [], headSha: 'a'.repeat(40), env, exec, wait: () => {} }).state, 'success')
  assert.deepEqual(calls.map(call => call.split(' ')[0]), ['supabase', 'psql', 'node'])
})

test('history left behind by abandoned pull requests is repaired and the push retried', () => {
  const calls = []
  let pushes = 0
  const exec = (command, args) => {
    calls.push([command, ...args].slice(0, 4).join(' '))
    if (command === 'supabase' && args[0] === 'db' && ++pushes === 1) return { ok: false, output: 'supabase migration repair --status reverted 20261017000000 20269999999999\n' }
    return { ok: true, output: '' }
  }
  const result = stageDatabase({ migrations: [], headSha: 'a'.repeat(40), env, exec, wait: () => {} })
  assert.equal(result.state, 'success')
  assert.match(result.log, /20261017000000, 20269999999999/)
  assert.ok(calls.includes('supabase migration repair --status'))
})

test('missing staging credentials are a setup problem that names what is missing', () => {
  const result = stageDatabase({ migrations, headSha: 'a'.repeat(40), env: { ...env, STAGING_DATABASE_URL: '' }, exec: recorder().exec })
  assert.equal(result.state, 'setup')
  assert.match(result.log, /STAGING_DATABASE_URL/)
})

test('migrations are applied, then invariants and integration tests run against staging', () => {
  const { calls, exec } = recorder()
  const result = stageDatabase({ migrations, headSha: 'a'.repeat(40), env, exec, wait: () => {} })
  assert.equal(result.state, 'success')
  assert.deepEqual(calls.filter(call => !call.startsWith('git')), ['supabase db push', 'psql postgres://staging -v', 'node --test integration/*.test.mjs'])
})

test('a lock conflict is retried but a real failure stops the pipeline and skips later steps', () => {
  const retried = recorder({ 'supabase db push': 1 })
  assert.equal(stageDatabase({ migrations, headSha: 'a'.repeat(40), env, exec: retried.exec, wait: () => {} }).state, 'success')
  const failing = recorder({ 'supabase db push': true })
  const result = stageDatabase({ migrations, headSha: 'a'.repeat(40), env, exec: failing.exec, wait: () => {} })
  assert.equal(result.state, 'failure')
  assert.equal(failing.calls.filter(call => call.startsWith('supabase')).length, 3)
  assert.equal(failing.calls.some(call => call.startsWith('psql')), false)
})

test('failing staging integration tests fail the gate', () => {
  const { exec } = recorder({ 'node --test': true })
  assert.equal(stageDatabase({ migrations, headSha: 'a'.repeat(40), env, exec, wait: () => {} }).state, 'failure')
})
