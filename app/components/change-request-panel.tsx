'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

type ChangeRequest = { id: string; title: string; description: string; status: string; created_at: string; issue_url?: string; pr_url?: string }
const labels: Record<string, string> = { saved: 'Saved', publishing: 'Publishing to GitHub', github_pending: 'GitHub publication needs retry', submitted: 'Submitted', awaiting_authorization: 'Awaiting administrator', queued: 'Queued for Codex', implementing: 'Codex is implementing', review: 'Ready for review', merged: 'Merged · deployment pending', deployed: 'Deployed', failed: 'Implementation failed', closed: 'PR closed', status_unavailable: 'GitHub status unavailable' }

export default function ChangeRequestPanel() {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [requests, setRequests] = useState<ChangeRequest[]>([])
  const [isAdmin, setIsAdmin] = useState(false)
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
      setRequests(data.requests); setIsAdmin(data.isAdmin)
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

  async function submit(existing?: ChangeRequest) {
    setBusy(true); setError(''); setMessage('')
    requestId.current ||= crypto.randomUUID()
    try {
      const response = await fetch('/api/change-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(existing || { id: requestId.current, title, description }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to submit request.')
      if (!existing) { setTitle(''); setDescription(''); requestId.current = null }
      setMessage('Request saved. You can follow its progress below.'); await load()
    } catch (error) { setError(error instanceof Error ? error.message : 'Unable to submit request.') }
    finally { setBusy(false) }
  }

  async function authorize(id: string) {
    setBusy(true); setError('')
    try {
      const response = await fetch(`/api/change-requests/${id}/authorize`, { method: 'POST' })
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
      <form onSubmit={event => { event.preventDefault(); void submit() }}>
        <label htmlFor="change-title">Change title</label><input id="change-title" value={title} minLength={5} maxLength={120} required placeholder="For example: Add a dark mode toggle" onChange={event => { setTitle(event.target.value); requestId.current = null }} />
        <label htmlFor="change-description">What should change?</label><textarea id="change-description" value={description} minLength={20} maxLength={6000} required rows={5}
          placeholder="What happens now? What should happen instead? How will we know it works?" onChange={event => { setDescription(event.target.value); requestId.current = null }} />
        <small>Requests are sent to the app’s GitHub repository. Don’t include passwords or personal information. Up to 5 requests per day.</small>
        <button className="button primary block" type="submit" disabled={busy}>{busy ? 'Working…' : 'Submit request'}</button>
      </form>
      {error && <p className="change-request-error" role="alert">{error}</p>}
      {message && <p className="change-request-success" role="status">{message}</p>}
      <div className="change-request-list-heading"><h3>{isAdmin ? 'Recent requests' : 'Your requests'}</h3><button onClick={() => void load()} disabled={busy}>Refresh</button></div>
      {!requests.length && <p>No requests yet. Your first idea starts here.</p>}
      <ul className="change-request-list">{requests.map(item => <li key={item.id}><strong>{item.title}</strong><span className="change-request-status">{labels[item.status] || item.status}</span>
        <div className="change-request-links">{item.issue_url && <a href={item.issue_url} target="_blank" rel="noreferrer">View request ↗</a>}{item.pr_url && <a href={item.pr_url} target="_blank" rel="noreferrer">Review PR ↗</a>}
          {['saved', 'github_pending'].includes(item.status) && <button disabled={busy} onClick={() => void submit(item)}>Retry publication</button>}
          {isAdmin && item.status === 'awaiting_authorization' && <button disabled={busy} onClick={() => void authorize(item.id)}>Start Codex</button>}</div>
      </li>)}</ul>
    </section>}
    {!open && <span hidden data-unsaved={Boolean(title || description || busy)} />}
  </>
}
