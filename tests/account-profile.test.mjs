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
})
