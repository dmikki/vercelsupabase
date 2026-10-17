import { appendFileSync } from 'node:fs'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// Smoke-tests a deployed environment and proves it is the right commit, in the right environment,
// connected to the right database. Returns every check so the release report can show details.
export async function verifyDeployment({
  baseUrl, expectedSha, expectedEnvironment, productionHost = '', bypassSecret = '',
  fetchImpl = fetch, attempts = 18, delayMs = 10000, pause = sleep,
}) {
  const checks = []
  const record = (name, ok, detail = '') => { checks.push({ name, ok, detail }); return ok }
  const origin = baseUrl.replace(/\/$/, '')
  const request = (path, init = {}) => fetchImpl(`${origin}${path}`, {
    redirect: 'manual', signal: AbortSignal.timeout(20000),
    ...init, headers: { ...(bypassSecret ? { 'x-vercel-protection-bypass': bypassSecret } : {}), ...init.headers },
  })

  let info = null
  let lastProblem = 'no response'
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await request('/api/version?check=1')
      if ([401, 403].includes(response.status)) { lastProblem = `HTTP ${response.status}: deployment protection blocks automated checks; set the VERCEL_AUTOMATION_BYPASS_SECRET secret`; break }
      if (response.ok) {
        const body = await response.json()
        if (body.version === expectedSha) { info = body; break }
        lastProblem = `serving ${String(body.version).slice(0, 7)} instead of ${expectedSha.slice(0, 7)}`
      } else lastProblem = `HTTP ${response.status}`
    } catch (error) { lastProblem = error instanceof Error ? error.message : 'request failed' }
    if (attempt < attempts - 1) await pause(delayMs)
  }
  if (!record('Serves the expected commit', Boolean(info), info ? expectedSha.slice(0, 7) : lastProblem)) return { ok: false, checks }

  record('Runs in the expected environment', info.environment === expectedEnvironment, `${info.environment}`)
  if (expectedEnvironment === 'preview') {
    if (!productionHost) record('Preview is isolated from the production database', false, 'Repository variable PRODUCTION_SUPABASE_URL is not set, so isolation cannot be proven')
    else record('Preview is isolated from the production database', Boolean(info.supabaseHost) && info.supabaseHost !== productionHost, info.supabaseHost === productionHost ? 'PREVIEW USES THE PRODUCTION DATABASE' : `uses ${info.supabaseHost}`)
  } else if (productionHost) record('Production uses the production database', info.supabaseHost === productionHost, `${info.supabaseHost}`)
  record('Can reach its Supabase project', info.supabaseReachable === true, info.supabaseReachable === true ? '' : 'auth health check failed')

  const login = await request('/login').catch(() => null)
  record('Login page renders', Boolean(login?.ok) && (await login.text()).includes('<form'), login ? `HTTP ${login.status}` : 'no response')
  const account = await request('/account').catch(() => null)
  record('Account page requires login', Boolean(account) && account.status >= 300 && account.status < 400 && (account.headers.get('location') || '').includes('/login'), account ? `HTTP ${account.status}` : 'no response')
  const api = await request('/api/change-requests').catch(() => null)
  record('Change request API requires login', api?.status === 401, api ? `HTTP ${api.status}` : 'no response')
  return { ok: checks.every(check => check.ok), checks }
}

export function summarizeChecks(checks) {
  return checks.map(check => `${check.ok ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`).join('\n')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = process.env
  const required = ['DEPLOYMENT_URL', 'EXPECTED_SHA', 'EXPECTED_ENVIRONMENT']
  for (const name of required) if (!env[name]) throw new Error(`${name} is required`)
  const productionHost = (() => { try { return new URL(env.PRODUCTION_SUPABASE_URL || '').host } catch { return '' } })()
  const result = await verifyDeployment({
    baseUrl: env.DEPLOYMENT_URL, expectedSha: env.EXPECTED_SHA, expectedEnvironment: env.EXPECTED_ENVIRONMENT,
    productionHost, bypassSecret: env.VERCEL_AUTOMATION_BYPASS_SECRET || '',
  })
  console.log(summarizeChecks(result.checks))
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `ok=${result.ok}\nchecks=${JSON.stringify(result.checks)}\n`)
  if (!result.ok) process.exitCode = 1
}
