import Link from 'next/link'

import { login, signup } from './actions'

const highlights = [
  'Use the same workspace identity as the dashboard.',
  'Log in or create an account from the same secure form.',
  'Keep the experience focused, simple, and quick to scan.',
]

export default async function LoginPage({searchParams}: {searchParams: Promise<{message?: string}>}) {
  const {message} = await searchParams
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
