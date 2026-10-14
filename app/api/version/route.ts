export const dynamic = 'force-dynamic'
export function GET() {
  return Response.json({ version: process.env.VERCEL_GIT_COMMIT_SHA || 'local', production: process.env.VERCEL_ENV === 'production' }, {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  })
}
