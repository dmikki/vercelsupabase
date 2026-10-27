'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'

export async function requestPasswordReset(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim()
  if (!email) redirect('/login?message=' + encodeURIComponent('Enter your email address, then choose Forgot password.'))

  const supabase = await createClient()
  // headers() is async in Next.js 16. Supabase only honors redirect URLs on its allow-list, so a forged Host cannot redirect users elsewhere.
  const requestHeaders = await headers()
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host')
  if (!host) redirect('/login?message=' + encodeURIComponent('Unable to send a reset link right now. Please try again.'))
  const protocol = requestHeaders.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https')

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${protocol}://${host}/auth/confirm?next=/account&recovery=1`,
  })

  if (error) {
    redirect(
      '/login?message=' +
        encodeURIComponent(
          error.code === 'email_address_invalid'
            ? 'Please enter a valid email address.'
            : error.status === 429
              ? 'Too many attempts. Please wait a few minutes and try again.'
              : 'Unable to send a reset link right now. Please try again.'
        )
    )
  }

  redirect('/login?reset=sent')
}
