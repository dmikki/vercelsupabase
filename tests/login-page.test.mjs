import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const loginPageSource = readFileSync(new URL('../app/login/page.tsx', import.meta.url), 'utf8')
const loginPasswordActionsSource = readFileSync(new URL('../app/login/password-actions.ts', import.meta.url), 'utf8')
const loginStylesSource = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8')

test('login page uses the dashboard-style brand and both auth actions', () => {
  assert.ok(loginPageSource.includes('login-mark'))
  assert.ok(loginPageSource.includes('User workspace'))
  assert.ok(loginPageSource.includes('formAction={login}'))
  assert.ok(loginPageSource.includes('formAction={signup}'))
  assert.ok(loginPageSource.includes('formAction={requestPasswordReset}'))
  assert.ok(loginPageSource.includes('Forgot password?'))
  assert.ok(loginPasswordActionsSource.includes('resetPasswordForEmail'))
  assert.ok(loginPasswordActionsSource.includes("/auth/confirm?next=/account"))
  assert.ok(loginStylesSource.includes('.login-shell'))
  assert.ok(loginStylesSource.includes('.login-brand-panel'))
  assert.ok(loginStylesSource.includes('.login-reset-button'))
})
