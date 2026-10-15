import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const accountFormSource = readFileSync(new URL('../app/account/account-form.tsx', import.meta.url), 'utf8')
const dashboardShellSource = readFileSync(new URL('../app/components/dashboard-shell.tsx', import.meta.url), 'utf8')

test('account profile omits duplicate sign-out while the menu keeps it', () => {
  assert.equal(accountFormSource.includes('/auth/signout'), false)
  assert.equal(accountFormSource.includes('Sign out'), false)
  assert.equal(dashboardShellSource.includes('/auth/signout'), true)
  assert.equal(dashboardShellSource.includes('Sign out'), true)
  assert.equal(dashboardShellSource.includes('aria-hidden="true">♥</span> Request a change'), true)
  assert.equal(dashboardShellSource.includes('<span className="dashboard-card-icon">♥</span><h2>Request a change</h2>'), true)
})

test('account profile includes a mobile phone field stored in auth metadata', () => {
  assert.equal(accountFormSource.includes('Mobile phone number'), true)
  assert.equal(accountFormSource.includes('id="mobilePhone"'), true)
  assert.equal(accountFormSource.includes('type="tel"'), true)
  assert.equal(accountFormSource.includes('mobile_phone'), true)
  assert.equal(accountFormSource.includes('supabase.auth.updateUser'), true)
})
