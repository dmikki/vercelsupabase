// Builds the "release readiness" report an administrator reads before approving a release.
// Pure functions only: callers gather GitHub state, this module decides and renders.

export const REPORT_MARKER = '<!-- release-readiness -->'
const PAYLOAD = /<!-- readiness:(\{.*?\}) -->/s

const LABEL = { success: 'Passed', failure: 'Failed', pending: 'Waiting', skipped: 'Not needed', setup: 'Setup required' }

export function parseGates(check) {
  const line = /^gates:(\{.*\})$/m.exec(check?.output?.summary || '')?.[1]
  try { return line ? JSON.parse(line) : {} } catch { return {} }
}

const stateOf = result => ({ success: 'success', skipped: 'skipped', neutral: 'skipped', cancelled: 'failure', failure: 'failure', setup: 'setup' }[result] || 'pending')

function checkState(check) {
  if (!check || check.status !== 'completed') return 'pending'
  return stateOf(check.conclusion)
}

export function buildReadiness({ sha, base, migrations = [], ci, preview, vercel, approval, rollback = false, others = [], previewUrl = '' }) {
  const ciGates = parseGates(ci)
  const previewGates = parseGates(preview)
  const ciFresh = ci?.status === 'completed' && ci.conclusion === 'success' ? Boolean(ci.output?.summary?.includes(`base:${base}`)) : true
  const gates = []
  const add = (id, name, state, detail = '') => gates.push({ id, name, state, detail })

  const code = !ci || ci.status !== 'completed' ? 'pending' : !ciFresh ? 'pending' : stateOf(ciGates.code || ci.conclusion)
  add('code', 'Code checks: types, lint, unit tests, production build', code,
    !ci ? 'Waiting for validation to start' : !ciFresh ? 'Re-validating against the latest main' : '')
  if (migrations.length) {
    const database = !ci || ci.status !== 'completed' || !ciFresh ? 'pending' : stateOf(ciGates.database || (ci.conclusion === 'success' ? 'success' : 'pending'))
    add('database', 'Database upgrade test on existing data', database, `${migrations.length} new migration${migrations.length === 1 ? '' : 's'}`)
  } else add('database', 'Database upgrade test on existing data', 'skipped', 'No database changes')

  if (rollback) {
    add('staging', 'Staging database', 'skipped', 'Rollback keeps the additive schema')
    add('preview', 'Staging preview verification', 'skipped', 'Rollback returns to previously verified code')
  } else {
    const verified = checkState(preview)
    const staging = verified === 'pending' ? 'pending' : stateOf(previewGates.staging || (verified === 'success' ? 'success' : 'pending'))
    add('staging', 'Staging database', staging, staging !== 'success' ? '' : migrations.length ? 'Migrations applied and integration tests passed on staging' : 'Schema is current with main and integration tests passed on staging')
    add('preview', 'Staging preview verification', verified === 'pending' ? 'pending' : stateOf(previewGates.preview || (verified === 'success' ? 'success' : 'failure')),
      verified === 'pending' ? 'Waiting for the Vercel preview to be verified' : '')
  }
  if (ci?.status === 'completed' && ci.conclusion === 'failure' && !gates.some(gate => ['code', 'database'].includes(gate.id) && gate.state === 'failure')) {
    gates.find(gate => gate.id === 'code').state = 'failure'
  }
  add('vercel', 'Vercel preview build', vercel?.state || 'pending', vercel?.detail || '')
  for (const other of others) add(`other:${other.name}`, other.name, other.state, other.detail || '')
  add('approval', 'Your approval', approval === 'approved' ? 'success' : approval === 'rejected' ? 'failure' : 'pending',
    approval === 'approved' ? `Approved commit ${sha.slice(0, 7)}` : approval === 'rejected' ? 'Rejected' : 'Waiting for you')

  const technical = gates.filter(gate => gate.id !== 'approval')
  const failing = gates.some(gate => gate.state === 'failure')
  const setup = technical.some(gate => gate.state === 'setup')
  const waiting = technical.some(gate => gate.state === 'pending')
  const verdict = failing ? 'blocked' : setup ? 'setup' : waiting ? 'waiting' : approval === 'approved' ? 'approved' : 'ready'

  const details = []
  for (const check of previewGates.details || []) if (!check.ok) details.push(`${check.name}${check.detail ? `: ${check.detail}` : ''}`)
  for (const message of ciGates.problems || []) details.push(message)
  return { verdict, gates, details, sha, previewUrl, migrations, rollback }
}

const HEADLINE = {
  ready: 'Tested and ready for production. Waiting for your approval.',
  approved: 'Approved. Releasing to production.',
  waiting: 'Testing in progress. Nothing needs your attention yet.',
  blocked: 'Not ready for production. Remedy or reject.',
  setup: 'Testing cannot finish until the pipeline is configured.',
}

export function renderReport(readiness) {
  const { verdict, gates, details, sha, previewUrl, migrations, rollback } = readiness
  const lines = [REPORT_MARKER, `## Release readiness: ${HEADLINE[verdict]}`, '',
    `Commit \`${sha.slice(0, 7)}\`${previewUrl ? ` · [Staging preview](${previewUrl})` : ''}${rollback ? ' · Rollback of an earlier release' : ''}`, '',
    '| Check | Result | Detail |', '| --- | --- | --- |',
    ...gates.map(gate => `| ${gate.name} | **${LABEL[gate.state]}** | ${gate.detail || ''} |`), '']
  if (details.length) lines.push('### What failed', ...details.map(detail => `- ${detail}`), '')
  lines.push('### What production will receive')
  if (rollback) lines.push('- Code: the changes of the earlier release are reverted.', '- Database: unchanged. Additive schema from earlier releases stays in place and is compatible with the previous code.')
  else {
    lines.push('- Code: this pull request, deployed by Vercel after the merge.')
    lines.push(migrations.length
      ? `- Database: ${migrations.length} additive migration${migrations.length === 1 ? '' : 's'} (${migrations.map(name => `\`${name.split('/').pop()}\``).join(', ')}), applied to production only after you approve and immediately before the merge. They are backward compatible, so the running version keeps working and a code rollback needs no database rollback.`
      : '- Database: no changes.')
  }
  lines.push('', '### Your options')
  if (verdict === 'ready') lines.push(`- **Approve and release:** comment \`/approve ${sha}\` (or approve this exact commit in GitHub Review).`)
  if (['ready', 'blocked', 'waiting'].includes(verdict)) lines.push('- **Remedy:** comment `/remedy <what should change>` and Codex revises this pull request, then everything is tested again.')
  if (['ready', 'blocked', 'waiting', 'setup'].includes(verdict)) lines.push('- **Reject:** comment `/reject` to stop this release.')
  if (verdict === 'approved') lines.push('- A release is in progress. After it deploys, comment `/rollback` on the merged pull request to undo it.')
  if (verdict === 'setup') lines.push('- Complete the setup described in the failing checks, then re-run the workflow named in the check, or push a new commit.')
  lines.push('', `<!-- readiness:${JSON.stringify({ verdict, sha, gates: gates.map(({ id, name, state }) => ({ id, name, state })) })} -->`)
  return lines.join('\n')
}

export function readReportPayload(body) {
  if (!body?.includes(REPORT_MARKER)) return null
  try { return JSON.parse(PAYLOAD.exec(body)?.[1] || 'null') } catch { return null }
}

// One automatic repair attempt per pull request, only for failures caused by the change itself.
export function shouldAutoRemedy(readiness, existingMarkers) {
  if (readiness.rollback || existingMarkers > 0) return false
  if (readiness.gates.some(gate => gate.state === 'setup')) return false
  return readiness.gates.some(gate => gate.id !== 'approval' && gate.state === 'failure')
}

export function remedyInstructions(readiness) {
  const failed = readiness.gates.filter(gate => gate.state === 'failure' && gate.id !== 'approval').map(gate => `- ${gate.name}${gate.detail ? ` (${gate.detail})` : ''}`)
  const details = readiness.details.slice(0, 12).map(detail => `- ${detail.slice(0, 300)}`)
  return `Automatic remedy for commit ${readiness.sha}. These release checks failed:\n${failed.join('\n')}\n${details.length ? `\nDetails:\n${details.join('\n')}\n` : ''}\nFix the implementation, tests, or this request's migration so every check passes. Do not weaken or delete existing tests.`
}
