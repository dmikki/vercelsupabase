export const dynamic = 'force-dynamic'

// Public deployment facts used by the release pipeline to prove which commit, environment and
// database a deployment is wired to. Never include secrets here.
function supabaseHost() {
  try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '').host || null } catch { return null }
}

async function supabaseReachable() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) return false
  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/auth/v1/health`, { headers: { apikey: key }, cache: 'no-store', signal: AbortSignal.timeout(5000) })
    return response.ok
  } catch { return false }
}

export async function GET(request: Request) {
  const body: Record<string, unknown> = {
    version: process.env.VERCEL_GIT_COMMIT_SHA || 'local',
    production: process.env.VERCEL_ENV === 'production',
    environment: process.env.VERCEL_ENV || 'local',
    supabaseHost: supabaseHost(),
  }
  if (new URL(request.url).searchParams.get('check') === '1') body.supabaseReachable = await supabaseReachable()
  return Response.json(body, { headers: { 'Cache-Control': 'no-store, max-age=0' } })
}
