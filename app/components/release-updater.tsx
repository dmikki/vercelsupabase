'use client'
import { useEffect, useState } from 'react'

export default function ReleaseUpdater({ initialVersion }: { initialVersion: string }) {
  const [available, setAvailable] = useState(false)
  useEffect(() => {
    if (initialVersion === 'local') return
    let cancelled = false
    const check = async () => {
      if (document.hidden) return
      try {
        const response = await fetch('/api/version', { cache: 'no-store' })
        if (!response.ok) return
        const release = await response.json()
        if (cancelled || !release.production || release.version === initialVersion) return
        const editing = document.activeElement?.matches('input,textarea,[contenteditable="true"]')
        if (!editing && !document.querySelector('[data-unsaved="true"]')) window.location.reload()
        else setAvailable(true)
      } catch { /* Keep the current page usable during network or deployment failures. */ }
    }
    const timer = setInterval(() => void check(), 60000)
    const onFocus = () => void check()
    window.addEventListener('focus', onFocus)
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener('focus', onFocus) }
  }, [initialVersion])
  return available && <div className="release-notice" role="status">A new version is ready. Save your work, then <button onClick={() => window.location.reload()}>Update now</button>.</div>
}
