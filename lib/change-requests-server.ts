import 'server-only'
import { createClient as supabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { sameOrigin } from '@/lib/change-request-validation'

export async function requestContext(request?: Request) {
  if (request && request.method !== 'GET') {
    const origin = request.headers.get('origin')
    const protocol = request.headers.get('x-forwarded-proto')?.split(',')[0].trim() || new URL(request.url).protocol.slice(0,-1)
    if (!sameOrigin(origin, request.headers.get('host'), protocol)) throw new Error('Invalid request origin.')
  }
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) throw new Error('Please log in to request changes.')
  const admins = (process.env.DEVELOPMENT_ADMIN_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean)
  return { supabase, user, isAdmin: admins.includes(user.id) }
}

export function requestAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Change request storage is not configured yet.')
  return supabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export function requestError(error: unknown) {
  // Database/provider error details stay on the server, not in user-facing responses.
  console.error('Change request operation failed', error instanceof Error ? error.message : 'Provider error')
  const message = error instanceof Error ? error.message : 'Unable to process the request. Please retry.'
  const status = message.startsWith('Please log in') ? 401 : message.startsWith('Invalid request origin') ? 403 : 400
  return Response.json({ error: message }, { status })
}
