'use client'

import type { CostEstimate } from '@/lib/change-request-cost'
import { useCallback, useEffect, useRef, useState } from 'react'

type ChangeRequest = { id: string; title: string; description: string; status: string; created_at: string; estimate?: CostEstimate; usage?: { input:number; cached:number; output:number; usd:number; complete:boolean; available:boolean }[]; issue_url?: string; pr_url?: string }
const labels: Record<string, string> = { saved: 'Saved', publishing: 'Publishing to GitHub', github_pending: 'GitHub publication needs retry', submitted: 'Submitted', awaiting_authorization: 'Awaiting administrator', queued: 'Queued for Codex', implementing: 'Codex is implementing', review: 'Ready for review', merged: 'Merged · deployment pending', deployed: 'Deployed', failed: 'Implementation failed', closed: 'PR closed', status_unavailable: 'GitHub status unavailable' }

export default function ChangeRequestPanel() {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [requests, setRequests] = useState<ChangeRequest[]>([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [quote, setQuote] = useState<{estimate:CostEstimate;token:string;autoApproved:boolean}|null>(null)
  const [threshold, setThreshold] = useState('0')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const requestId = useRef<string | null>(null)
  const policyLoaded = useRef(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/change-requests', { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to load requests.')
      setRequests(data.requests); setIsAdmin(data.isAdmin)
      if(data.isAdmin && !policyLoaded.current) { const policy=await fetch('/api/change-requests/settings',{cache:'no-store'}); const p=await policy.json(); if(policy.ok) {setThreshold(String(p.autoApproveUsd));policyLoaded.current=true} }
    } catch (error) { setError(error instanceof Error ? error.message : 'Unable to load requests.') }
  }, [])

  useEffect(() => {
    if (!open) return
    void load(); heading.current?.focus()
    const timer = setInterval(() => { if (!document.hidden) void load() }, 60000)
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus() } }
    document.addEventListener('keydown', escape)
    return () => { clearInterval(timer); document.removeEventListener('keydown', escape) }
  }, [open, load])

  async function getEstimate(t=title,d=description) {
    const response=await fetch('/api/change-requests/estimate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:crypto.randomUUID(),title:t,description:d})})
    const data=await response.json(); if(!response.ok) throw new Error(data.error || 'Unable to estimate.')
    return data as {estimate:CostEstimate;token:string;autoApproved:boolean}
  }
  async function estimate() { setBusy(true);setError('');try {setQuote(await getEstimate())} catch(e){setError(e instanceof Error?e.message:'Unable to estimate.')} finally{setBusy(false)} }
  async function savePolicy() { setBusy(true);setError('');try {const response=await fetch('/api/change-requests/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({autoApproveUsd:Number(threshold)})}); const data=await response.json();if(!response.ok)throw new Error(data.error);setQuote(null);setMessage('Automatic approval policy saved.');}catch(e){setError(e instanceof Error?e.message:'Unable to save policy.')}finally{setBusy(false)} }
  async function submit(existing?: ChangeRequest) {
    setBusy(true); setError(''); setMessage('')
    requestId.current ||= crypto.randomUUID()
    try {
      const response = await fetch('/api/change-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(existing || { id: requestId.current, title, description }), estimateToken:(existing ? await getEstimate(existing.title,existing.description) : quote)?.token, acceptEstimate: !existing && isAdmin }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to submit request.')
      if (!existing) { setTitle(''); setDescription(''); setQuote(null); requestId.current = null }
      setMessage('Request saved. You can follow its progress below.'); await load()
    } catch (error) { setError(error instanceof Error ? error.message : 'Unable to submit request.') }
    finally { setBusy(false) }
  }

  async function authorize(item: ChangeRequest) {
    setBusy(true); setError('')
    try {
      const q=await getEstimate(item.title,item.description)
      if(q.estimate.manualOnly) throw new Error('This request needs manual engineering.')
      if(!window.confirm(`Approve the current planning range $${q.estimate.usd[0].toFixed(2)}–$${q.estimate.usd[1].toFixed(2)} and start implementation? This is not a spending cap.`)) return
      const response = await fetch(`/api/change-requests/${item.id}/authorize`, { method: 'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({estimateToken:q.token,acceptEstimate:true}) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to start implementation.')
      setMessage('Implementation authorized. Codex will open a PR for review.'); await load()
    } catch (error) { setError(error instanceof Error ? error.message : 'Unable to start implementation.') }
    finally { setBusy(false) }
  }

  return <>
    <button ref={trigger} className="change-request-trigger" aria-expanded={open} aria-controls="change-request-panel"
      onClick={() => setOpen(value => !value)}>
      <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9H13a8.5 8.5 0 0 1 8 8v.5Z"/></svg>
      Request a change
    </button>
    {open && <section id="change-request-panel" className="change-request-panel" role="dialog" aria-modal="false" aria-labelledby="change-request-heading"
      data-unsaved={Boolean(title || description || busy)}>
      <header className="change-request-header"><div><span className="change-request-eyebrow">BUILD WITH US</span><h2 id="change-request-heading" ref={heading} tabIndex={-1}>What should we improve?</h2></div>
        <button aria-label="Close change requests" onClick={() => { setOpen(false); trigger.current?.focus() }}>×</button></header>
      <p>Describe a feature or fix. We’ll track it through implementation, review, and release.</p>
      <form onSubmit={event => { event.preventDefault(); void estimate() }}>
        <label htmlFor="change-title">Change title</label><input id="change-title" value={title} minLength={5} maxLength={120} required placeholder="For example: Add a dark mode toggle" onChange={event => { setTitle(event.target.value); setQuote(null); requestId.current = null }} />
        <label htmlFor="change-description">What should change?</label><textarea id="change-description" value={description} minLength={20} maxLength={6000} required rows={5}
          placeholder="What happens now? What should happen instead? How will we know it works?" onChange={event => { setDescription(event.target.value); setQuote(null); requestId.current = null }} />
        <small>Requests are sent to the app’s GitHub repository. Don’t include passwords or personal information. Up to 5 requests per day.</small>
        <button className="button primary block" type="submit" disabled={busy}>{busy ? 'Working…' : 'Estimate change'}</button>
      </form>
      {quote && <div className="change-request-estimate" aria-live="polite">
        <h3>Estimated API cost: ${quote.estimate.usd[0].toFixed(2)}–${quote.estimate.usd[1].toFixed(2)}</h3>
        <p>{quote.estimate.scope} · {quote.estimate.model}</p>
        <p>Input: {quote.estimate.input.map(n=>n.toLocaleString()).join('–')} tokens<br/>Output: {quote.estimate.output.map(n=>n.toLocaleString()).join('–')} tokens</p>
        <small>{quote.estimate.assumptions} Rates checked {quote.estimate.pricing.date}. <a href={quote.estimate.pricing.source} target="_blank" rel="noreferrer">Pricing ↗</a></small>
        <p>{quote.estimate.manualOnly ? 'This scope needs manual engineering; submitting will not launch Codex.' : quote.autoApproved ? 'Accepting this estimate starts Codex automatically. Code still requires GitHub approval.' : 'Your request will wait for administrator spending approval.'}</p>
        <button className="button primary block" disabled={busy} onClick={()=>void submit()}>{quote.autoApproved ? 'Approve estimate & implement' : 'Submit with estimate'}</button>
        <button disabled={busy} onClick={()=>setQuote(null)}>Cancel estimate</button>
      </div>}
      {isAdmin && <details className="change-request-estimate"><summary>Automatic spending approval</summary>
        <p>Automatically authorize eligible requests from other users when the estimate’s upper end is at or below this amount. Zero turns it off. This is not a billing cap.</p>
        <label htmlFor="auto-approval">Threshold (USD)</label><input id="auto-approval" type="number" min="0" max="100" step="0.01" value={threshold} onChange={e=>setThreshold(e.target.value)} />
        <button disabled={busy} onClick={()=>void savePolicy()}>Save threshold</button>
      </details>}
      {error && <p className="change-request-error" role="alert">{error}</p>}
      {message && <p className="change-request-success" role="status">{message}</p>}
      <div className="change-request-list-heading"><h3>{isAdmin ? 'Recent requests' : 'Your requests'}</h3><button onClick={() => void load()} disabled={busy}>Refresh</button></div>
      {!requests.length && <p>No requests yet. Your first idea starts here.</p>}
      <ul className="change-request-list">{requests.map(item => <li key={item.id}><strong>{item.title}</strong><span className="change-request-status">{labels[item.status] || item.status}</span>
        {item.estimate && <small>Planning range: ${item.estimate.usd[0].toFixed(2)}–${item.estimate.usd[1].toFixed(2)} · {item.estimate.model}<br/>Estimated input: {item.estimate.input.map(n=>n.toLocaleString()).join('–')} / output: {item.estimate.output.map(n=>n.toLocaleString()).join('–')} tokens</small>}
        {item.usage?.some(u=>u.available) ? <small>Recorded usage ({item.usage.length} run{item.usage.length===1?'':'s'}): {item.usage.reduce((n,u)=>n+u.input,0).toLocaleString()} input / {item.usage.reduce((n,u)=>n+u.output,0).toLocaleString()} output tokens · calculated API cost ${item.usage.reduce((n,u)=>n+u.usd,0).toFixed(4)}{item.usage.some(u=>!u.complete) ? ' · incomplete usage; total cost may be higher' : ''}</small> : <small>Actual token usage: {item.usage?.length ? 'unavailable; API charges may still apply.' : 'not reported yet.'}</small>}
        <div className="change-request-links">{item.issue_url && <a href={item.issue_url} target="_blank" rel="noreferrer">View request ↗</a>}{item.pr_url && <a href={item.pr_url} target="_blank" rel="noreferrer">Review PR ↗</a>}
          {['saved', 'github_pending'].includes(item.status) && <button disabled={busy} onClick={() => void submit(item)}>Retry publication</button>}
          {isAdmin && item.status === 'awaiting_authorization' && <button disabled={busy} onClick={() => void authorize(item)}>Approve estimate & implement</button>}</div>
      </li>)}</ul>
    </section>}
    {!open && <span hidden data-unsaved={Boolean(title || description || busy)} />}
  </>
}
