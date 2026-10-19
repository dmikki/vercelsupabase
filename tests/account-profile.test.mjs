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

test('account profile loads and saves the company name', () => {
  assert.equal(accountFormSource.includes('htmlFor="companyName"'), true)
  assert.match(accountFormSource, /select\(`[^`]*company_name[^`]*`\)/)
  assert.equal(accountFormSource.includes('company_name: companyName?.trim() || null'), true)
})

test('account page heading says your account', () => {
  assert.equal(dashboardShellSource.includes("section==='profile'?'Your account'"), true)
})
