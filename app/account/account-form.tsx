'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Avatar from './avatar'

type Claims = { sub: string; email?: string; [key: string]: unknown }

export default function AccountForm({ claims }: { claims: Claims | null }) {
  const [supabase] = useState(() => createClient())
  const [dirty, setDirty] = useState(false)
  const userId = claims?.sub
  const [loading, setLoading] = useState(Boolean(userId))
  const [fullname, setFullname] = useState<string | null>(null)
  const [username, setUsername] = useState<string | null>(null)
  const [website, setWebsite] = useState<string | null>(null)
  const [mobilePhone, setMobilePhone] = useState<string | null>(null)
  const [companyName, setCompanyName] = useState<string | null>(null)
  const [avatar_url, setAvatarUrl] = useState<string | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordLoading, setPasswordLoading] = useState(false)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    supabase
      .from('profiles')
      .select(`full_name, username, website, avatar_url, mobile_phone, company_name`)
      .eq('id', userId)
      .single()
      .then(({ data, error, status }) => {
        if (cancelled) return
        if (error && status !== 406) {
          console.log(error)
          alert('Error loading user data!')
        } else if (data) {
          setFullname(data.full_name)
          setUsername(data.username)
          setWebsite(data.website)
          setAvatarUrl(data.avatar_url)
          setMobilePhone(data.mobile_phone)
          setCompanyName(data.company_name)
        }
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [userId, supabase])

  async function updateProfile({
    username,
    website,
    avatar_url,
    mobile_phone,
  }: {
    username: string | null
    fullname: string | null
    website: string | null
    avatar_url: string | null
    mobile_phone: string | null
  }) {
    try {
      if (!claims?.sub) {
        alert('You must be logged in to update your profile')
        return
      }

      setLoading(true)

      const { error } = await supabase.from('profiles').upsert({
        id: claims.sub,
        full_name: fullname,
        username,
        website,
        avatar_url,
        mobile_phone: mobile_phone?.trim() || null,
        company_name: companyName?.trim() || null,
        updated_at: new Date().toISOString(),
      })
      if (error) throw error

      setDirty(false)
      alert('Profile updated!')
    } catch {
      alert('Error updating the data!')
    } finally {
      setLoading(false)
    }
  }

  async function updatePassword() {
    if (!newPassword || !confirmPassword) {
      alert('Enter and confirm your new password before saving.')
      return
    }
    if (newPassword !== confirmPassword) {
      alert('Passwords do not match.')
      return
    }

    try {
      setPasswordLoading(true)
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error

      setNewPassword('')
      setConfirmPassword('')
      alert('Password updated!')
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      alert(message || 'Error updating the password!')
    } finally {
      setPasswordLoading(false)
    }
  }

  return (
    <div className="form-widget" data-unsaved={dirty || loading || passwordLoading}>
      <Avatar
        uid={claims?.sub ?? null}
        url={avatar_url}
        size={150}
        onUpload={(url) => {
          setAvatarUrl(url)
          updateProfile({ fullname, username, website, avatar_url: url, mobile_phone: mobilePhone })
        }}
      />
      <div>
        <label htmlFor="email">Email</label>
        <input id="email" type="text" value={claims?.email ?? ''} disabled />
      </div>
      <div>
        <label htmlFor="fullName">Full Name</label>
        <input
          id="fullName"
          type="text"
          value={fullname || ''}
          onChange={(e) => { setFullname(e.target.value); setDirty(true) }}
        />
      </div>
      <div>
        <label htmlFor="username">Username</label>
        <input
          id="username"
          type="text"
          value={username || ''}
          onChange={(e) => { setUsername(e.target.value); setDirty(true) }}
        />
      </div>
      <div>
        <label htmlFor="website">Website</label>
        <input
          id="website"
          type="url"
          value={website || ''}
          onChange={(e) => { setWebsite(e.target.value); setDirty(true) }}
        />
      </div>
      <div>
        <label htmlFor="mobilePhone">Mobile phone number</label>
        <input
          id="mobilePhone"
          type="tel"
          autoComplete="tel"
          value={mobilePhone || ''}
          onChange={(e) => { setMobilePhone(e.target.value); setDirty(true) }}
        />
      </div>
      <div>
        <label htmlFor="companyName">Company name</label>
        <input
          id="companyName"
          type="text"
          autoComplete="organization"
          maxLength={120}
          value={companyName || ''}
          onChange={(e) => { setCompanyName(e.target.value); setDirty(true) }}
        />
      </div>

      <section className="profile-password-section" aria-labelledby="change-password-heading">
        <div className="profile-password-copy">
          <h2 id="change-password-heading">Change password</h2>
          <p>Update the password on this account without leaving your profile.</p>
        </div>
        <div>
          <label htmlFor="newPassword">New password</label>
          <input
            id="newPassword"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="confirmPassword">Confirm new password</label>
          <input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </div>
        <button
          className="button primary block"
          type="button"
          onClick={updatePassword}
          disabled={passwordLoading || loading || !newPassword || !confirmPassword}
        >
          {passwordLoading ? 'Updating ...' : 'Change password'}
        </button>
      </section>

      <div>
        <button
          className="button primary block"
          onClick={() => updateProfile({ fullname, username, website, avatar_url, mobile_phone: mobilePhone })}
          disabled={loading || !claims?.sub}
        >
          {loading ? 'Loading ...' : 'Update'}
        </button>
      </div>
    </div>
  )
}
