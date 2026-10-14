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
  const complex = /database|schema|migration|payment|authentication|oauth|dependency|infrastructure/i.test(text)
  const medium = text.length > 800 || /integration|multiple|dashboard|upload|search|filter|menu/i.test(text)
  const scope = complex ? 'Complex / may require manual engineering' : medium ? 'Medium' : 'Small'
  const input = complex ? [200000,1000000] : medium ? [80000,500000] : [30000,200000]
  input[0]+=attachmentReserve; input[1]+=attachmentReserve*3
  const output = complex ? [20000,100000] : medium ? [8000,40000] : [3000,15000]
  return { version: 1, model: MODEL, pricing: PRICING, scope, input, output,
    usd: [tokenCost(input[0],0,output[0]),tokenCost(input[1],0,output[1])],
    manualOnly: complex, assumptions: 'Heuristic planning range for one run in this example app, including repeated context and reasoning. No cache discount assumed. Not a quote or spending cap. Retries and revisions can add cost; excludes hosting, GitHub minutes, taxes and provider adjustments.' }
}
export type CostEstimate = ReturnType<typeof estimateChange>
export function mayAutoApprove(isAdmin: boolean, accepted: boolean, estimate: CostEstimate, threshold: number) {
  return !estimate.manualOnly && ((isAdmin && accepted) || (Number.isFinite(threshold) && threshold > 0 && estimate.usd[1] < threshold))
}
