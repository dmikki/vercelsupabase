'use client'

import { useEffect, useRef } from 'react'

export default function SignupNotice({ confirmation, existing, message, title }: { confirmation: boolean; existing: boolean; message: string; title?: string }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const noticeTitle = title ?? (confirmation ? 'Sign-up successful — confirm your email' : existing ? 'Check your registration email' : 'Sign-up successful')

  useEffect(() => {
    const notice = dialog.current
    if (notice && !notice.open) notice.showModal()
    return () => { if (notice?.open) notice.close() }
  }, [])

  return (
    <>
      <div role="status" className="signup-status">
        <strong>{noticeTitle}</strong>
        <p>{message}</p>
      </div>
      <dialog ref={dialog} aria-labelledby="signup-notice-title" aria-describedby="signup-notice-message" className="signup-dialog">
        <h2 id="signup-notice-title">{noticeTitle}</h2>
        <p id="signup-notice-message">{message}</p>
        {confirmation && <p>You cannot log in until you click the confirmation link. Check your spam folder if the email is missing.</p>}
        <button type="button" className="button primary" onClick={() => dialog.current?.close()}>Got it</button>
      </dialog>
    </>
  )
}
