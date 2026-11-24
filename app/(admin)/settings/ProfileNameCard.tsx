'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

/**
 * Lets each user set the name shown in "Responsible" pickers and filters, and the
 * phone number contractors see as their contact on the portal and in notify emails.
 */
export default function ProfileNameCard({ userId, email, fullName, phone: initialPhone }: {
  userId: string
  email: string | null
  fullName: string | null
  phone: string | null
}) {
  const [name, setName] = useState(fullName ?? '')
  const [phone, setPhone] = useState(initialPhone ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const supabase = createClient()
  const router = useRouter()

  const dirty = name.trim() !== (fullName ?? '') || phone.trim() !== (initialPhone ?? '')

  async function save(e: React.FormEvent) {
    e.preventDefault()
    const p = phone.trim().replace(/\s+/g, ' ')
    if (p && !/^[0-9+()\-.\s]{3,40}$/.test(p)) { setError('Phone number can only contain digits, spaces and + ( ) - .'); return }
    setSaving(true)
    setError('')
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: name.trim() || null, phone: p || null, updated_at: new Date().toISOString() })
      .eq('id', userId)
    setSaving(false)
    if (error) { setError(error.message); return }
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
    router.refresh()
  }

  return (
    <form onSubmit={save} style={{ maxWidth: 640, border: '1px solid #e9e9e7', borderRadius: 8, padding: '20px 24px', marginBottom: 16 }}>
      <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 600 }}>Your Profile</h3>
      <p style={{ color: '#787774', fontSize: 14, marginTop: 0, marginBottom: 16 }}>
        Your name is shown when maintenance items are assigned to you. Contractors see your name, phone and email as their contact for your items. Signed in as {email ?? 'unknown'}.
      </p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div>
          <label htmlFor="profile-name" style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 5 }}>Name</label>
          <input
            id="profile-name"
            className="input"
            style={{ width: 260, maxWidth: '100%' }}
            placeholder="e.g. Christian"
            value={name}
            maxLength={100}
            onChange={e => setName(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="profile-phone" style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 5 }}>Phone</label>
          <input
            id="profile-phone"
            className="input"
            type="tel"
            style={{ width: 200, maxWidth: '100%' }}
            placeholder="e.g. 021 123 4567"
            value={phone}
            maxLength={40}
            onChange={e => setPhone(e.target.value)}
          />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="submit" className="btn btn-primary" disabled={saving || !dirty}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saved && <span style={{ fontSize: 13, color: '#2f7d4a' }}>Saved</span>}
        {error && <span style={{ fontSize: 13, color: '#e03c3c' }}>{error}</span>}
      </div>
    </form>
  )
}
