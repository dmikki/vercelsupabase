export const repository = process.env.GITHUB_REPOSITORY
if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '')) throw new Error('Invalid repository')
export async function api(path, method = 'GET', body) {
  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
    method, headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000),
  })
  if (!response.ok) throw new Error(`GitHub ${method} ${path}: ${response.status}`)
  return response.status === 204 ? undefined : response.json()
}
export async function label(number, name) {
  return api(`/issues/${number}/labels`, 'POST', { labels: [name] })
}
export async function allPages(path) {
  const rows = []
  for (let page = 1; page <= 100; page++) {
    const items = await api(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`)
    rows.push(...items)
    if (items.length < 100) return rows
  }
  throw new Error('Pagination limit exceeded; automatic operation stopped.')
}
export async function removeLabel(number, name) {
  try { await api(`/issues/${number}/labels/${name}`, 'DELETE') } catch { /* May already be absent. */ }
}
