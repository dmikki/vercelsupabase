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

  const { error } = await supabase.auth.signUp(data)

  if (error) {
    redirect('/login?message=' + encodeURIComponent(error.code === 'weak_password' ? 'Please choose a stronger password.' : error.status === 429 ? 'Too many attempts. Please wait a few minutes and try again.' : 'Unable to sign up. Check your details and try again.'))
  }

  revalidatePath('/', 'layout')
  redirect('/account')
}
