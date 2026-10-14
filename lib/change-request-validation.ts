export function parseChangeRequest(value: unknown) {
  if (!value || typeof value !== 'object') throw new Error('Invalid request.')
  const v = value as Record<string, unknown>
  if (typeof v.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.id))
    throw new Error('Invalid request ID.')
  if (typeof v.title !== 'string' || v.title.trim().length < 5 || v.title.trim().length > 120)
    throw new Error('Use a title between 5 and 120 characters.')
  if (typeof v.description !== 'string' || v.description.trim().length < 20 || v.description.trim().length > 6000)
    throw new Error('Describe the change in 20–6,000 characters.')
  if (v.kind !== undefined && !['change','suggestion'].includes(v.kind as string)) throw new Error('Invalid request type.')
  return { kind: (v.kind || 'change') as 'change' | 'suggestion', id: v.id, title: v.title.trim(), description: v.description.trim() }
}
export function sameOrigin(origin: string | null, host: string | null, protocol: string) {
  if (!origin || !host) return false
  try {
    const url = new URL(origin)
    return ['http:', 'https:'].includes(url.protocol) && url.host === host && url.protocol === `${protocol}:`
  } catch { return false }
}

