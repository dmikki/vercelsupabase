import Link from 'next/link'

import { login, signup } from './actions'

const highlights = [
  'Use the same workspace identity as the dashboard.',
  'Log in or create an account from the same secure form.',
  'Keep the experience focused, simple, and quick to scan.',
]

export default async function LoginPage({searchParams}: {searchParams: Promise<{message?: string; signup?: string}>}) {
  const {message, signup: signupStatus} = await searchParams
  const signupMessage = signupStatus === 'success'
    ? 'Sign-up successful! Please log in with your email and password.'
    : signupStatus === 'confirm'
      ? 'Sign-up successful! Check your inbox (and spam folder) to confirm your email, then return here and log in.'
      : null
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
          <h2 id="login-heading">Welcome back</h2>
          <p>Use your email and password to continue.</p>
        </div>

        {signupMessage && <p role="status" style={{padding: '12px 16px', border: '1px solid #3f6d55', borderRadius: 12, color: '#dff8ea'}}>{signupMessage}</p>}
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
        </form>
      </section>
    </main>
  )
}
