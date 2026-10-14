export function allowedPath(path) {
  if (path.includes('..') || path.startsWith('/') || path.includes('\\')) return false
  if (!/^(app|lib|public|tests)\//.test(path)) return false
  if (/^(lib\/supabase\/|app\/auth\/|app\/login\/actions\.)/.test(path)) return false
  if (/^(app\/api\/(change-requests|version)(\/|$)|app\/components\/(change-request-panel|release-updater|dashboard-shell)\.|lib\/(change-request|development-github))/.test(path)) return false
  if (/(^|\/)\.[^/]+/.test(path)) return false
  return /\.(tsx?|jsx?|mjs|css|json|svg|png|jpe?g|webp|md)$/.test(path)
}

export function approvalSha(body) {
  return /^\/approve\s+([0-9a-f]{40})\s*$/i.exec(body.trim())?.[1]?.toLowerCase() || null
}

export function checksPass(runs, statuses, requiredName, expectedSha, baseSha) {
  const ci = runs.find(run => run.name === requiredName && run.app?.slug === 'github-actions' && run.head_sha === expectedSha)
  if (!ci || ci.status !== 'completed' || ci.conclusion !== 'success') return false
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
