// Reads the release report that the pipeline keeps on each pull request, so administrators can see
// whether a change is tested and ready for production without opening GitHub.
export const REPORT_MARKER = '<!-- release-readiness -->'
export type ReadinessGate = { id: string; name: string; state: 'success' | 'failure' | 'pending' | 'skipped' | 'setup' }
export type Readiness = { verdict: 'ready' | 'approved' | 'waiting' | 'blocked' | 'setup'; sha: string; gates: ReadinessGate[] }
export type ProductionCheck = { ok: boolean; sha: string }
type Comment = { body?: string; user?: { type?: string } }

const bot = (comment: Comment) => comment.user?.type === 'Bot'

export function readinessFromComments(comments: Comment[]): Readiness | null {
  for (const comment of [...comments].reverse()) {
    if (!bot(comment) || !comment.body?.includes(REPORT_MARKER)) continue
    const payload = /<!-- readiness:(\{.*?\}) -->/.exec(comment.body)?.[1]
    try {
      const parsed = JSON.parse(payload || 'null')
      if (parsed && typeof parsed.verdict === 'string' && Array.isArray(parsed.gates)) return parsed as Readiness
    } catch { /* A malformed report is treated as missing. */ }
  }
  return null
}

export function productionFromComments(comments: Comment[]): ProductionCheck | null {
  for (const comment of [...comments].reverse()) {
    if (!bot(comment)) continue
    const payload = /<!-- production-verification:(\{.*?\}) -->/.exec(comment.body || '')?.[1]
    try {
      const parsed = JSON.parse(payload || 'null')
      if (parsed && typeof parsed.ok === 'boolean') return parsed as ProductionCheck
    } catch { /* Ignore malformed markers. */ }
  }
  return null
}

export const verdictLabels: Record<Readiness['verdict'], string> = {
  ready: 'Tested and ready for production. Your approval is needed.',
  approved: 'Approved. Releasing to production.',
  waiting: 'Testing in progress.',
  blocked: 'Not ready for production. Remedy or reject.',
  setup: 'Testing is blocked by missing pipeline configuration.',
}

export function readinessSummary(readiness: Readiness) {
  const failed = readiness.gates.filter(gate => gate.state === 'failure' || gate.state === 'setup').map(gate => gate.name)
  const waiting = readiness.gates.filter(gate => gate.state === 'pending' && gate.id !== 'approval').map(gate => gate.name)
  return { label: verdictLabels[readiness.verdict], failed, waiting }
}
