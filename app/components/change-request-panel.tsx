'use client'

import {attachmentType,MAX_ATTACHMENTS} from '@/lib/change-request-attachments'
import {AUTO_APPROVAL_LIMIT_USD,type CostEstimate } from '@/lib/change-request-cost'
import { readinessSummary, type ProductionCheck, type Readiness } from '@/lib/release-readiness'
import { useCallback, useEffect, useRef, useState } from 'react'

type Attachment = {id:string;name:string;mime:string;size:number;url?:string}
type ChangeRequest = { id: string; kind?:'change'|'suggestion'; attachments?:Attachment[]; title: string; description: string; status: string; created_at: string; estimate?: CostEstimate; usage?: { input:number; cached:number; output:number; usd:number; complete:boolean; available:boolean }[]; issue_url?: string; pr_url?: string; readiness?: Readiness | null; production?: ProductionCheck | null }
const gateLabels: Record<string, string> = { success: 'passed', failure: 'failed', pending: 'waiting', skipped: 'not needed', setup: 'setup required' }
const labels: Record<string, string> = { saved: 'Saved', publishing: 'Publishing to GitHub', github_pending: 'GitHub publication needs retry', submitted: 'Submitted', awaiting_authorization: 'Awaiting administrator', queued: 'Queued for Codex', implementing: 'Codex is implementing', review: 'Ready for review', merged: 'Merged · deployment pending', deployed: 'Deployed', failed: 'Implementation failed', closed: 'PR closed', status_unavailable: 'GitHub status unavailable' }

export default function ChangeRequestPanel() {
  const [open, setOpen] = useState(false)
  const [kind,setKind]=useState<'change'|'suggestion'>('change')
  const [attachments,setAttachments]=useState<Attachment[]>([])
  const draftId=useRef<string|null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [requests, setRequests] = useState<ChangeRequest[]>([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [canViewLinks, setCanViewLinks] = useState(false)
  const [quote, setQuote] = useState<{estimate:CostEstimate;token:string;autoApproved:boolean}|null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const requestId = useRef<string | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/change-requests', { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to load requests.')
      setRequests(data.requests); setIsAdmin(data.isAdmin); setCanViewLinks(data.canViewRepositoryLinks === true)

    } catch (error) { setError(error instanceof Error ? error.message : 'Unable to load requests.') }
  }, [])

  useEffect(() => {
    if (!open) return
    heading.current?.focus()
    const timer = setInterval(() => { if (!document.hidden) void load() }, 60000)
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); (document.querySelector('.dashboard-request-button') as HTMLButtonElement|null)?.focus() } }
    document.addEventListener('keydown', escape)
    return () => { clearInterval(timer); document.removeEventListener('keydown', escape) }
  }, [open, load])

  useEffect(()=>{
    const show=(event:Event)=>{setOpen(true);void load();if(!title&&!description&&!attachments.length)setKind((event as CustomEvent).detail?.kind==='suggestion'?'suggestion':'change')}
    window.addEventListener('open-change-request',show);return()=>window.removeEventListener('open-change-request',show)
  },[title,description,attachments.length,load])
  async function uploadFiles(files:FileList|null) {
    if(!files)return
    setError('');setBusy(true);setQuote(null)
    try {
      if(attachments.length+files.length>MAX_ATTACHMENTS)throw Error('Attach up to 5 files per request.')
      for(const file of Array.from(files))attachmentType(file.name,file.size)
      draftId.current ||= crypto.randomUUID()
      for(const file of Array.from(files)) {
        const form=new FormData();form.append('file',file);form.append('draftId',draftId.current)
        const response=await fetch('/api/change-requests/attachments',{method:'POST',body:form}),data=await response.json()
        if(!response.ok)throw Error(data.error||'Upload failed.')
        setAttachments(previous=>[...previous,data.attachment])
      }
    }catch(e){setError(e instanceof Error?e.message:'Upload failed.')}finally{setBusy(false)}
  }
  async function removeAttachment(id:string) {
    setBusy(true);setError('');setQuote(null)
    try {const response=await fetch('/api/change-requests/attachments',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})}),data=await response.json();if(!response.ok)throw Error(data.error);setAttachments(previous=>previous.filter(f=>f.id!==id))}catch(e){setError(e instanceof Error?e.message:'Unable to remove file.')}finally{setBusy(false)}
  }
  async function getEstimate(t=title,d=description,files=attachments,k=kind,id=requestId.current || crypto.randomUUID()) {
    const response=await fetch('/api/change-requests/estimate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,title:t,description:d,kind:k,attachments:files.map(f=>f.id)})})
    const data=await response.json(); if(!response.ok) throw new Error(data.error || 'Unable to estimate.')
    return data as {estimate:CostEstimate;token:string;autoApproved:boolean}
  }
  async function estimate() {
    setBusy(true);setError('')
    try {
      const q=await getEstimate()
      if(!q.estimate.manualOnly&&q.estimate.usd[1]<AUTO_APPROVAL_LIMIT_USD) await submit(undefined,q)
      else setQuote(q)
    }catch(e){setError(e instanceof Error?e.message:'Unable to estimate.')}finally{setBusy(false)}
  }
  async function submit(existing?: ChangeRequest, acceptedQuote=quote) {
    setBusy(true); setError(''); setMessage('')
    requestId.current ||= crypto.randomUUID()
    try {
      const response = await fetch('/api/change-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(existing || { id: requestId.current, title, description }), kind:existing?.kind || kind, attachments:(existing?.attachments || attachments).map(f=>f.id), estimateToken:(existing ? await getEstimate(existing.title,existing.description,existing.attachments||[],existing.kind||'change',existing.id) : acceptedQuote)?.token, acceptEstimate: !existing && isAdmin }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to submit request.')
      if (!existing) { setTitle(''); setDescription(''); setAttachments([]);draftId.current=null;setQuote(null); requestId.current = null }
      setMessage(isAdmin ? 'Request saved. Codex will open a PR; it merges only after you approve it. Follow progress below.' : 'Request saved. The administrator will review it before any work starts. Follow progress below.'); await load()
    } catch (error) { setError(error instanceof Error ? error.message : 'Unable to submit request.') }
    finally { setBusy(false) }
  }

  async function renewReferences(id:string) {
    setBusy(true);setError('')
    try {const response=await fetch(`/api/change-requests/${id}/references`,{method:'POST'}),data=await response.json();if(!response.ok)throw Error(data.error);setMessage('Attachment links renewed for 24 hours. You can retry implementation from GitHub Actions.')}catch(e){setError(e instanceof Error?e.message:'Unable to renew references.')}finally{setBusy(false)}
  }
  async function authorize(item: ChangeRequest) {
    setBusy(true); setError('')
    try {
      const q=await getEstimate(item.title,item.description,item.attachments||[],item.kind||'change',item.id)
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
    <button ref={trigger} className="change-request-trigger dashboard-hidden-trigger" aria-expanded={open} aria-controls="change-request-panel"
      onClick={() => { if (!open) void load(); setOpen(value => !value) }}>
      <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9H13a8.5 8.5 0 0 1 8 8v.5Z"/></svg>
      Request a change
    </button>
    {open && <section id="change-request-panel" className="change-request-panel" role="dialog" aria-modal="false" aria-labelledby="change-request-heading"
      data-unsaved={Boolean(title || description || attachments.length || busy)}>
      <header className="change-request-header"><div><span className="change-request-eyebrow">BUILD WITH US</span><h2 id="change-request-heading" ref={heading} tabIndex={-1}>{kind==='suggestion'?'Share an improvement':'What should we improve?'}</h2></div>
        <button aria-label="Close change requests" onClick={() => { setOpen(false); (document.querySelector('.dashboard-request-button') as HTMLButtonElement|null)?.focus() }}>×</button></header>
      <p>Describe a feature or fix. We’ll track it through implementation, review, and release.</p>
      <form onSubmit={event => { event.preventDefault(); void estimate() }}>
        <label htmlFor="request-kind">Request type</label><select id="request-kind" value={kind} disabled={busy} onChange={e=>{setKind(e.target.value as 'change'|'suggestion');setQuote(null);requestId.current=null}}><option value="change">Feature or fix</option><option value="suggestion">Suggestion</option></select>
        <label htmlFor="change-title">Change title</label><input id="change-title" value={title} minLength={5} maxLength={120} required placeholder="For example: Add a dark mode toggle" onChange={event => { setTitle(event.target.value); setQuote(null); requestId.current = null }} />
        <label htmlFor="change-description">What should change?</label><textarea id="change-description" value={description} minLength={20} maxLength={6000} required rows={5}
          placeholder="What happens now? What should happen instead? How will we know it works?" onChange={event => { setDescription(event.target.value); setQuote(null); requestId.current = null }} />
        <label htmlFor="reference-files">Attach files or screenshots</label><input id="reference-files" type="file" multiple accept=".png,.jpg,.jpeg,.webp,.txt,.md,.csv,.json" disabled={busy} onChange={e=>{void uploadFiles(e.target.files);e.target.value=''}} />
        <small>Up to 5 files. Images: 2 MB each. TXT, MD, CSV and JSON: 100 KB each. Files are shared with your repository’s reviewers and Codex for this request.</small>
        <ul className="request-attachments">{attachments.map(file=><li key={file.id}>{file.mime.startsWith('image/')&&file.url&&<img src={file.url} alt={`Reference: ${file.name}`} />}<div><strong>{file.name}</strong><small>{(file.size/1024).toFixed(0)} KB · Uploaded</small></div><button type="button" disabled={busy} aria-label={`Remove ${file.name}`} onClick={()=>void removeAttachment(file.id)}>×</button></li>)}</ul>
        <small>Requests are sent to the app’s GitHub repository. Don’t include passwords or personal information. Up to 5 requests per day.</small>
        <button className="button primary block" type="submit" disabled={busy}>{busy ? 'Working…' : 'Estimate & submit'}</button>
      </form>
      {quote && <div className="change-request-estimate" aria-live="polite">
        <h3>Estimated API cost: ${quote.estimate.usd[0].toFixed(2)}–${quote.estimate.usd[1].toFixed(2)}</h3>
        <p>{quote.estimate.scope} · {quote.estimate.model}</p>
        <p>Input: {quote.estimate.input.map(n=>n.toLocaleString()).join('–')} tokens<br/>Output: {quote.estimate.output.map(n=>n.toLocaleString()).join('–')} tokens</p>
        <small>{quote.estimate.assumptions} Rates checked {quote.estimate.pricing.date}. <a href={quote.estimate.pricing.source} target="_blank" rel="noreferrer">Pricing ↗</a></small>
        <p>{quote.estimate.manualOnly ? 'This scope needs manual engineering; submitting will not launch Codex.' : quote.autoApproved ? 'Accepting this estimate starts Codex. The resulting PR still needs owner approval before it merges.' : 'Your request will wait for administrator approval.'}</p>
        <button className="button primary block" disabled={busy} onClick={()=>void submit()}>{quote.autoApproved ? 'Approve estimate & implement' : 'Submit with estimate'}</button>
        <button disabled={busy} onClick={()=>setQuote(null)}>Cancel estimate</button>
      </div>}
      <details className="change-request-estimate"><summary>Approval policy</summary><p>Only the administrator can start implementation. Every change is tested automatically, including database changes on a staging copy, and approved by the owner before it merges and deploys to production. Estimates are not billing caps.</p></details>
      {error && <p className="change-request-error" role="alert">{error}</p>}
      {message && <p className="change-request-success" role="status">{message}</p>}
      <div className="change-request-list-heading"><h3>{isAdmin ? 'Recent requests' : 'Your requests'}</h3><button onClick={() => void load()} disabled={busy}>Refresh</button></div>
      {!requests.length && <p>No requests yet. Your first idea starts here.</p>}
      <ul className="change-request-list">{requests.map(item => <li key={item.id}><strong>{item.title}</strong><small>{item.kind==='suggestion'?'Suggestion':'Feature or fix'}</small><span className="change-request-status" role="status">Status: {labels[item.status] || item.status}</span>
        {isAdmin && item.readiness && <div className="release-readiness" data-verdict={item.readiness.verdict}>
          <strong>{readinessSummary(item.readiness).label}</strong>
          <ul>{item.readiness.gates.filter(gate => gate.state !== 'skipped').map(gate => <li key={gate.id} data-state={gate.state}>{gate.name}: {gateLabels[gate.state] || gate.state}</li>)}</ul>
          {canViewLinks && item.pr_url && <small>{item.readiness.verdict === 'ready' ? 'Approve, remedy or reject' : 'Details and options'} on the pull request: <a href={item.pr_url} target="_blank" rel="noreferrer">Open release report ↗</a></small>}
        </div>}
        {isAdmin && item.production && <small className="release-production" data-ok={item.production.ok}>Production: {item.production.ok ? 'released and verified.' : 'released but failed verification. Open the pull request and comment /rollback to undo it.'}</small>}
        {item.estimate && <small>Planning range: ${item.estimate.usd[0].toFixed(2)}–${item.estimate.usd[1].toFixed(2)} · {item.estimate.model}<br/>Estimated input: {item.estimate.input.map(n=>n.toLocaleString()).join('–')} / output: {item.estimate.output.map(n=>n.toLocaleString()).join('–')} tokens</small>}
        {item.usage?.some(u=>u.available) ? <small>Recorded usage ({item.usage.length} run{item.usage.length===1?'':'s'}): {item.usage.reduce((n,u)=>n+u.input,0).toLocaleString()} input / {item.usage.reduce((n,u)=>n+u.output,0).toLocaleString()} output tokens · calculated API cost ${item.usage.reduce((n,u)=>n+u.usd,0).toFixed(4)}{item.usage.some(u=>!u.complete) ? ' · incomplete usage; total cost may be higher' : ''}</small> : <small>Actual token usage: {item.usage?.length ? 'unavailable; API charges may still apply.' : 'not reported yet.'}</small>}
        {Boolean(item.attachments?.length)&&<ul className="request-reference-links">{item.attachments?.map(file=><li key={file.id}>{file.url&&<a href={file.url} target="_blank" rel="noreferrer">{file.mime.startsWith('image/')&&<img src={file.url} alt={`Reference: ${file.name}`}/>}<span>{file.name} ↗</span></a>}</li>)}</ul>}
        <div className="change-request-links">{canViewLinks && item.issue_url && <a href={item.issue_url} target="_blank" rel="noreferrer">View request ↗</a>}{canViewLinks && item.pr_url && <a href={item.pr_url} target="_blank" rel="noreferrer">Review PR ↗</a>}
          {['saved', 'github_pending'].includes(item.status) && <button disabled={busy} onClick={() => void submit(item)}>Retry publication</button>}
          {isAdmin && item.status==='failed' && Boolean(item.attachments?.length) && <button disabled={busy} onClick={()=>void renewReferences(item.id)}>Renew attachment links</button>}
          {isAdmin && item.status === 'awaiting_authorization' && <button disabled={busy} onClick={() => void authorize(item)}>Approve estimate & implement</button>}</div>
      </li>)}</ul>
    </section>}
    {!open && <span hidden data-unsaved={Boolean(title || description || attachments.length || busy)} />}
  </>
}
