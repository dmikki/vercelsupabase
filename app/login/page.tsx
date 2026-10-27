import Link from 'next/link'

import { login, signup } from './actions'
import { requestPasswordReset } from './password-actions'
import SignupNotice from './signup-notice'

const highlights = [
  'Use the same workspace identity as the dashboard.',
  'Log in or create an account from the same secure form.',
  'Keep the experience focused, simple, and quick to scan.',
]

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ message?: string; signup?: string; reset?: string }> }) {
  const { message, signup: signupStatus, reset } = await searchParams
  const signupMessage = signupStatus === 'existing'
    ? 'Check your email for confirmation instructions if registration is pending. If you already confirmed your account, please log in.'
    : signupStatus === 'success'
      ? 'Sign-up successful! Please log in with your email and password.'
      : signupStatus === 'confirm'
        ? 'Sign-up successful! Check your inbox (and spam folder) to confirm your email, then return here and log in.'
        : null
  const resetMessage = reset === 'sent'
    ? 'If an account exists for that email, we sent a password reset link. Check your inbox and spam folder.'
    : null
  const noticeMessage = signupMessage ?? resetMessage
  const heading = signupStatus === 'confirm' || reset === 'sent'
    ? 'Check your email'
    : noticeMessage
      ? 'Your next step'
      : 'Welcome back'

  return (
    <main className="login-shell">
      <section className="login-brand-panel">
        <Link href="/" className="login-brand">
          <span className="login-mark" aria-hidden="true">
            U
          </span>
          <span>
            User workspace
            <small>vercelsupabase</small>
          </span>
        </Link>
        <div className="login-copy">
          <span className="login-eyebrow">Supabase auth</span>
          <h1>Sign in to manage your workspace.</h1>
          <p>
            Keep your profile current, review change requests, and move between the dashboard and
            account tools without losing context.
          </p>
        </div>
        <ul className="login-highlights">
          {highlights.map((highlight) => (
            <li key={highlight}>{highlight}</li>
          ))}
        </ul>
      </section>

      <section className="login-card" aria-labelledby="login-heading">
        <div className="login-card-header">
          <span className="login-eyebrow">Secure access</span>
          <h2 id="login-heading">{heading}</h2>
          <p>{resetMessage ? 'Use the reset link we sent to choose a new password.' : 'Use your email and password to continue.'}</p>
        </div>

        {noticeMessage && (
          <SignupNotice
            confirmation={signupStatus === 'confirm'}
            existing={signupStatus === 'existing'}
            message={noticeMessage}
            title={resetMessage ? 'Password reset email sent' : undefined}
          />
        )}
        {message && <p role="alert">{message}</p>}
        <form className="login-form">
          <label htmlFor="email">Email address</label>
          <input id="email" name="email" type="email" autoComplete="email" required />

          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />

          <div className="login-actions">
            <button className="primary" formAction={login} type="submit">
              Log in
            </button>
            <button formAction={signup} type="submit">
              Sign up
            </button>
          </div>

          <button className="button link login-reset-button" formAction={requestPasswordReset} formNoValidate type="submit">
            Forgot password?
          </button>
          <p className="login-reset-note">We’ll email a reset link if the address belongs to an account.</p>
        </form>
      </section>
    </main>
  )
}
