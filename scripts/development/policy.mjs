import { migrationPath } from './migration-policy.mjs'

export function allowedPath(path) {
  if (path.includes('..') || path.startsWith('/') || path.includes('\\')) return false
  // Migrations are additionally validated by migration-policy.mjs and must be new files.
  if (migrationPath(path)) return true
  if (!/^(app|lib|public|tests)\//.test(path)) return false
  if (/^(lib\/supabase\/|app\/auth\/|app\/login\/actions\.)/.test(path)) return false
  if (/^(app\/api\/|app\/components\/(change-request-panel|release-updater)\.|lib\/(change-request|development-github))/.test(path)) return false
  // Route handlers and proxies run on the server with access to secrets, wherever they live.
  if (/(^|\/)(route|proxy|middleware)\.[^/]+$/.test(path)) return false
  if (/(^|\/)\.[^/]+/.test(path)) return false
  return /\.(tsx?|jsx?|mjs|css|json|svg|png|jpe?g|webp|md)$/.test(path)
}

// Generated code must not read server secrets, add server actions, or import privileged server modules.
const forbiddenPatterns = [
  [/\bprocess\s*(\.|\[)/, 'reads process environment'],
  [/['"]use server['"]/, 'adds a server action'],
  [/['"][^'"]*(change-requests-server|change-request-[\w-]*-server|development-github|supabase-js)['"]/, 'imports a privileged server module'],
]

export function forbiddenAddition(patch) {
  for (const line of patch.split('\n')) {
    if (!line.startsWith('+') || line.startsWith('+++')) continue
    for (const [pattern, reason] of forbiddenPatterns) if (pattern.test(line)) return reason
  }
  return null
}

export function approvalSha(body) {
  return /^\/approve\s+([0-9a-f]{40})\s*$/i.exec(body.trim())?.[1]?.toLowerCase() || null
}

export function checksPass(runs, statuses, requiredName, expectedSha, baseSha, extraRequired = []) {
  const ci = runs.find(run => run.name === requiredName && run.app?.slug === 'github-actions' && run.head_sha === expectedSha)
  if (!ci || ci.status !== 'completed' || ci.conclusion !== 'success') return false
  for (const name of extraRequired) {
    const extra = runs.find(run => run.name === name && run.app?.slug === 'github-actions' && run.head_sha === expectedSha)
    if (!extra || extra.status !== 'completed' || extra.conclusion !== 'success') return false
  }
  // Merge validation must have tested the current base as well as the approved head.
  if (!ci.output?.summary?.includes(`base:${baseSha}`)) return false
  const latest = new Map()
  for (const status of statuses) if (!latest.has(status.context)) latest.set(status.context, status)
  const vercel = [...latest.values()].filter(status => status.context.toLowerCase().includes('vercel') && status.creator?.login === 'vercel[bot]')
  const vercelChecks = runs.filter(run => run.app?.slug === 'vercel')
  if (!vercel.length && !vercelChecks.length) return false
  if (vercel.some(status => status.state !== 'success') || vercelChecks.some(run => run.status !== 'completed' || run.conclusion !== 'success')) return false
  return [...latest.values()].every(status => status.state === 'success') && runs.every(run => run.status === 'completed' && ['success','neutral','skipped'].includes(run.conclusion))
}
