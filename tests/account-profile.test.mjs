import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const accountFormSource = readFileSync(new URL('../app/account/account-form.tsx', import.meta.url), 'utf8')
const accountPageSource = readFileSync(new URL('../app/account/page.tsx', import.meta.url), 'utf8')
const confirmRouteSource = readFileSync(new URL('../app/auth/confirm/route.ts', import.meta.url), 'utf8')
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

test('account profile exposes a change password section and recovery notice', () => {
  assert.equal(accountFormSource.includes('Change password'), true)
  assert.equal(accountFormSource.includes('supabase.auth.updateUser({ password: newPassword })'), true)
  assert.equal(accountFormSource.includes('autoComplete="new-password"'), true)
  assert.equal(accountPageSource.includes('Password reset confirmed. Choose a new password below.'), true)
  assert.equal(confirmRouteSource.includes("type === 'recovery'"), true)
})

test('confirm route accepts token hash and PKCE code links and never redirects off the profile page', () => {
  assert.equal(confirmRouteSource.includes('verifyOtp({ type, token_hash })'), true)
  assert.equal(confirmRouteSource.includes('exchangeCodeForSession(code)'), true)
  assert.equal(confirmRouteSource.includes("const next = '/account'"), true)
  assert.equal(confirmRouteSource.includes("searchParams.get('next')"), false)
})

test('account page heading says business profile', () => {
  assert.equal(dashboardShellSource.includes('<h2>Business Profile</h2>'), true)
  assert.equal(dashboardShellSource.includes("useState('profile')"), true)
})
