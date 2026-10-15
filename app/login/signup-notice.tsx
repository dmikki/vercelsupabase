'use client'

import { useEffect, useRef } from 'react'

export default function SignupNotice({ confirmation, existing, message }: { confirmation: boolean; existing: boolean; message: string }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const title = confirmation ? 'Sign-up successful — confirm your email' : existing ? 'Check your registration email' : 'Sign-up successful'

  useEffect(() => {
    const notice = dialog.current
    if (notice && !notice.open) notice.showModal()
    return () => { if (notice?.open) notice.close() }
  }, [])

  return (
    <>
      <div role="status" style={{ padding: '16px', border: '1px solid #3f6d55', borderRadius: 12, background: '#163325', color: '#dff8ea', marginBottom: 20 }}>
        <strong>{title}</strong>
        <p>{message}</p>
      </div>
      <dialog ref={dialog} aria-labelledby="signup-notice-title" aria-describedby="signup-notice-message" style={{ margin: 'auto', padding: 28, maxWidth: 'min(440px, calc(100vw - 32px))', border: '2px solid #6ebf8f', borderRadius: 16, background: '#163325', color: '#fff', boxShadow: '0 0 0 100vmax #0009' }}>
        <h2 id="signup-notice-title">{title}</h2>
        <p id="signup-notice-message">{message}</p>
        {confirmation && <p>You cannot log in until you click the confirmation link. Check your spam folder if the email is missing.</p>}
        <button type="button" className="button primary" onClick={() => dialog.current?.close()}>Got it</button>
      </dialog>
    </>
  )
}
