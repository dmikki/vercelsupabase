type Viewer = { email?: string | null; email_confirmed_at?: string | null }

export function canViewRepositoryLinks(user: Viewer) {
  return Boolean(user.email_confirmed_at) && user.email?.trim().toLowerCase() === 'durga1@gmail.com'
}

export function requestForViewer<T extends { github_issue_number?: unknown; issue_url?: unknown; pr_url?: unknown }>(request: T, allowed: boolean) {
  if (allowed) return request
  const { github_issue_number, issue_url, pr_url, ...visible } = request
  return visible
}
