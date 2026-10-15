'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'

export async function login(formData: FormData) {
  const supabase = await createClient()

  // type-casting here for convenience
  // in practice, you should validate your inputs
  const data = {
    email: formData.get('email') as string,
    password: formData.get('password') as string,
  }

  const { error } = await supabase.auth.signInWithPassword(data)

  if (error) {
    redirect('/login?message=' + encodeURIComponent(error.code === 'invalid_credentials' ? 'Incorrect email or password. Please try again.' : error.code === 'email_not_confirmed' ? 'Please confirm your email before logging in.' : error.status === 429 ? 'Too many attempts. Please wait a few minutes and try again.' : 'Unable to log in right now. Please try again.'))
  }

  revalidatePath('/', 'layout')
  redirect('/account')
}

export async function signup(formData: FormData) {
  const supabase = await createClient()

  // type-casting here for convenience
  // in practice, you should validate your inputs
  const data = {
    email: formData.get('email') as string,
    password: formData.get('password') as string,
  }

  const { data: result, error } = await supabase.auth.signUp(data)

  if (error) {
    redirect('/login?message=' + encodeURIComponent(error.code === 'weak_password' ? 'Please choose a stronger password.' : error.status === 429 ? 'Too many attempts. Please wait a few minutes and try again.' : error.code === 'user_already_exists' ? 'An account already exists for this email. Please log in.' : error.code === 'email_address_invalid' ? 'Please enter a valid email address.' : error.code === 'signup_disabled' ? 'New account registration is currently disabled.' : error.code === 'email_address_not_authorized' ? 'Registration emails cannot be sent to this address yet. Please contact the administrator.' : 'Unable to sign up right now. Please try again or contact the administrator.'))
  }

  // Supabase can return an obfuscated existing user without an error.
  if (result.user?.identities?.length === 0) {
    redirect('/login?message=' + encodeURIComponent('If you already registered, please log in. Otherwise, check your email for confirmation instructions.'))
  }
  if (!result.user) {
    redirect('/login?message=' + encodeURIComponent('Unable to complete sign-up. Please try again.'))
  }
  // Require an explicit login even when email confirmation is disabled.
  if (result.session) {
    const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' })
    if (signOutError) redirect('/login?message=' + encodeURIComponent('Account created, but we could not reset the session. Please refresh and log in.'))
  }
  revalidatePath('/', 'layout')
  redirect(result.session ? '/login?signup=success' : '/login?signup=confirm')
}
