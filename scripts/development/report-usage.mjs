import {api,allPages} from './github.mjs'
import {readUsage} from './usage.mjs'
const number=Number(process.env.ISSUE_NUMBER)
if(!Number.isSafeInteger(number)||number<1) throw Error('Invalid issue')
const run=process.env.GITHUB_RUN_ID, attempt=process.env.GITHUB_RUN_ATTEMPT
if(!/^\d+$/.test(run||'')||!/^\d+$/.test(attempt||'')) throw Error('Invalid run')
const jobs=await api(`/actions/runs/${run}/attempts/${attempt}/jobs?per_page=100`)
const job=jobs.jobs.find(j=>j.name==='implement')
let usage={input:0,cached:0,output:0,turns:0,valid:false}
if(job) {
  for(let retry=0;retry<3;retry++) {
    try {
      const response=await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/jobs/${job.id}/logs`,{headers:{Authorization:`Bearer ${process.env.GH_TOKEN}`,Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(20000)})
      if(response.ok) {usage=readUsage(await response.text());break}
    }catch { /* Logs may not be available yet; report unknown rather than zero billed. */ }
    if(retry<2) await new Promise(resolve=>setTimeout(resolve,3000))
  }
}
const complete=usage.valid&&process.env.IMPLEMENT_RESULT==='success'
const marker=`[app-request-usage] ${JSON.stringify({run:`${run}:${attempt}`,model:'gpt-5.4-mini',input:usage.input,cached:usage.cached,output:usage.output,complete,turns:usage.turns})}`
const body=`${marker}\n\n${usage.valid ? 'Recorded Codex completion-event usage. Calculated cost uses published standard model rates, not a billing invoice.' : 'Token usage unavailable. Zero counters here do not mean zero API cost.'}\n${!complete?'This report is incomplete; failed or interrupted calls may add unreported cost.':''}\nRun: https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${run}`
const comments=await allPages(`/issues/${number}/comments`)
const existing=comments.find(c=>c.user?.login==='github-actions[bot]' && c.body?.startsWith(`[app-request-usage] {"run":"${run}:${attempt}"`))
if(existing) await api(`/issues/comments/${existing.id}`,'PATCH',{body})
else await api(`/issues/${number}/comments`,'POST',{body})
