'use client'
import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Avatar from './avatar'

type Claims = { sub: string; email?: string; [key: string]: unknown }

export default function AccountForm({ claims }: { claims: Claims | null }) {
  const [supabase] = useState(() => createClient())
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [fullname, setFullname] = useState<string | null>(null)
  const [username, setUsername] = useState<string | null>(null)
  const [website, setWebsite] = useState<string | null>(null)
  const [mobilePhone, setMobilePhone] = useState<string | null>(null)
  const [avatar_url, setAvatarUrl] = useState<string | null>(null)

  const getProfile = useCallback(async () => {
    try {
      if (!claims?.sub) {
        setLoading(false)
        return
      }

      setLoading(true)

      const { data, error, status } = await supabase
        .from('profiles')
        .select(`full_name, username, website, avatar_url`)
        .eq('id', claims.sub)
        .single()

      if (error && status !== 406) {
        console.log(error)
        throw error
      }

      if (data) {
        setFullname(data.full_name)
        setUsername(data.username)
        setWebsite(data.website)
        setAvatarUrl(data.avatar_url)
      }

      const { data: userData } = await supabase.auth.getUser()
      setMobilePhone(userData.user?.user_metadata?.mobile_phone ?? null)
    } catch (error) {
      alert('Error loading user data!')
    } finally {
      setLoading(false)
    }
  }, [claims, supabase])

  useEffect(() => {
    getProfile()
  }, [claims, getProfile])

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
        updated_at: new Date().toISOString(),
      })
      if (error) throw error

      const { error: mobilePhoneError } = await supabase.auth.updateUser({
        data: { mobile_phone: mobile_phone || null },
      })
      if (mobilePhoneError) throw mobilePhoneError

      setDirty(false)
      alert('Profile updated!')
    } catch (error) {
      alert('Error updating the data!')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="form-widget" data-unsaved={dirty || loading}>
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

