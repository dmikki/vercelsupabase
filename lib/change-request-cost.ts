// Standard USD pricing verified 2026-10-14; keep workflow model and rates together.
export const AUTO_APPROVAL_LIMIT_USD = 1
export const MODEL = 'gpt-5.4-mini'
export const PRICING = { input: 0.75, cached: 0.075, output: 4.5, date: '2026-10-14', source: 'https://developers.openai.com/api/docs/models/gpt-5.4-mini' }
export function tokenCost(input: number, cached: number, output: number) {
  if (![input,cached,output].every(n => Number.isSafeInteger(n) && n >= 0) || cached > input) throw new Error('Invalid usage')
  return ((input-cached)*PRICING.input + cached*PRICING.cached + output*PRICING.output)/1_000_000
}
export function estimateChange(title: string, description: string, attachmentReserve=0) {
  const text = `${title} ${description}`
  // Anything touching sign-in, passwords, sessions, email links, server actions or secrets needs protected files, which automation can never publish.
  const complex = /payment|authenticat|\bauth\b|oauth|password|passcode|forgot|magic.?link|\bsso\b|\bmfa\b|\b2fa\b|two.?factor|session|server action|api route|route handler|middleware|webhook|cookie|api key|secret|environment variable|dependency|infrastructure/i.test(text)
  // Additive schema changes are automated: tested locally, on staging, then applied to production after approval.
  const database = !complex && /database|schema|migration|table|column/i.test(text)
  const medium = database || text.length > 800 || /integration|multiple|dashboard|upload|search|filter|menu/i.test(text)
  const scope = complex ? 'Complex / may require manual engineering' : database ? 'Database change (staged migration)' : medium ? 'Medium' : 'Small'
  const input = complex ? [200000,1000000] : database ? [120000,700000] : medium ? [80000,500000] : [30000,200000]
  input[0]+=attachmentReserve; input[1]+=attachmentReserve*3
  const output = complex ? [20000,100000] : database ? [12000,60000] : medium ? [8000,40000] : [3000,15000]
  return { version: 1, model: MODEL, pricing: PRICING, scope, input, output,
    usd: [tokenCost(input[0],0,output[0]),tokenCost(input[1],0,output[1])],
    manualOnly: complex, assumptions: 'Heuristic planning range for one run in this example app, including repeated context and reasoning. No cache discount assumed. Not a quote or spending cap. Retries and revisions can add cost; excludes hosting, GitHub minutes, taxes and provider adjustments.' }
}
export type CostEstimate = ReturnType<typeof estimateChange>
// Only an administrator's explicit acceptance starts Codex; requests from other users wait for authorization.
export function mayAutoApprove(isAdmin: boolean, accepted: boolean, estimate: CostEstimate) {
  return !estimate.manualOnly && isAdmin && accepted
}
