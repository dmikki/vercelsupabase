import { type EmailOtpType } from '@supabase/supabase-js'
import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Creating a handler to a GET request to route /auth/confirm
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const token_hash = searchParams.get('token_hash')
  const code = searchParams.get('code')
  const type = searchParams.get('type') as EmailOtpType | null
  // Only the profile page is a valid landing page, so a crafted link can never redirect elsewhere.
  const next = '/account'
  const recovery = type === 'recovery' || searchParams.get('recovery') === '1'

  // Create redirect link without the secret token or code
  const redirectTo = request.nextUrl.clone()
  redirectTo.pathname = next
  for (const name of ['token_hash', 'code', 'type', 'next', 'recovery']) redirectTo.searchParams.delete(name)

  const supabase = await createClient()
  let error: unknown = new Error('Missing confirmation parameters')

  if (token_hash && type) {
    // Email link carrying a token hash (custom email templates).
    error = (await supabase.auth.verifyOtp({ type, token_hash })).error
  } else if (code) {
    // Default Supabase email links return a PKCE code to the redirect URL.
    error = (await supabase.auth.exchangeCodeForSession(code)).error
  }

  if (!error) {
    if (recovery) redirectTo.searchParams.set('recovery', '1')
    return NextResponse.redirect(redirectTo)
  }

  // return the user to an error page with some instructions
  redirectTo.pathname = '/error'
  return NextResponse.redirect(redirectTo)
}
