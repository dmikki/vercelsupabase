import { createClient } from '@supabase/supabase-js'
import { randomBytes, randomUUID } from 'node:crypto'

const url = process.env.SUPABASE_URL
const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !anonKey || !serviceKey) throw new Error('Set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY (or SUPABASE_ANON_KEY) and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY).')

const options = { auth: { persistSession: false, autoRefreshToken: false } }
export const admin = createClient(url, serviceKey, options)
export const anonymous = () => createClient(url, anonKey, options)
export const run = randomBytes(4).toString('hex')

const created = []

export async function createUser(label) {
  const email = `integration-${run}-${label}@example.test`
  const password = randomBytes(18).toString('base64url')
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `Integration ${label}` } })
  if (error) throw new Error(`Unable to create test user: ${error.message}`)
  created.push(data.user.id)
  const client = anonymous()
  const signedIn = await client.auth.signInWithPassword({ email, password })
  if (signedIn.error) throw new Error(`Unable to sign in test user: ${signedIn.error.message}`)
  return { id: data.user.id, email, client }
}

// Test users never outlive the run, including on staging.
export async function cleanup() {
  if (!created.length) return
  for (const bucket of ['avatars', 'change-request-attachments']) {
    for (const id of created) {
      const { data } = await admin.storage.from(bucket).list(id)
      if (data?.length) await admin.storage.from(bucket).remove(data.map(file => `${id}/${file.name}`))
    }
  }
  await admin.from('change_requests').delete().in('user_id', created)
  await admin.from('profiles').delete().in('id', created)
  for (const id of created) await admin.auth.admin.deleteUser(id)
}

export const newId = () => randomUUID()
export const denied = result => Boolean(result.error) || (Array.isArray(result.data) && result.data.length === 0)
