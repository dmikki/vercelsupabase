import { readFile } from 'node:fs/promises'
import { api, allPages } from './github.mjs'
import { summarizeChecks, verifyDeployment } from './verify-deployment.mjs'

const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'))
const sha = event.deployment.sha
const url = event.deployment_status.environment_url || event.deployment_status.target_url
if (!/^[0-9a-f]{40}$/.test(sha) || !url) throw new Error('Deployment event is missing its commit or URL')
const productionHost = (() => { try { return new URL(process.env.PRODUCTION_SUPABASE_URL || '').host } catch { return '' } })()
const result = await verifyDeployment({ baseUrl: url, expectedSha: sha, expectedEnvironment: 'production', productionHost, bypassSecret: process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '' })
console.log(summarizeChecks(result.checks))

const pr = (await api(`/commits/${sha}/pulls`)).find(item => item.merged_at && item.merge_commit_sha === sha)
if (pr) {
  const marker = `<!-- production-verification:${JSON.stringify({ ok: result.ok, sha })} -->`
  const comments = await allPages(`/issues/${pr.number}/comments`)
  if (!comments.some(comment => comment.body?.includes(marker))) {
    const lines = result.checks.map(check => `- ${check.ok ? 'Passed' : '**Failed**'}: ${check.name}${check.detail ? ` (${check.detail})` : ''}`)
    const body = result.ok
      ? `## Production verified\n\nCommit \`${sha.slice(0, 7)}\` is live and healthy.\n\n${lines.join('\n')}\n\n${marker}`
      : `## Production verification FAILED\n\nCommit \`${sha.slice(0, 7)}\` is deployed but did not pass its health checks.\n\n${lines.join('\n')}\n\nComment \`/rollback\` to undo this release. Database changes are additive, so no database rollback is needed.\n\n${marker}`
    await api(`/issues/${pr.number}/comments`, 'POST', { body })
  }
}
if (!result.ok) process.exitCode = 1
