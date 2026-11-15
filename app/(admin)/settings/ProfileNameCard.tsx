'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

/** Lets each user set the name shown in "Assigned to" pickers and filters. */
export default function ProfileNameCard({ userId, email, fullName }: { userId: string; email: string | null; fullName: string | null }) {
  const [name, setName] = useState(fullName ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const supabase = createClient()
  const router = useRouter()

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: name.trim() || null, updated_at: new Date().toISOString() })
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
        Your name is shown when maintenance items are assigned to you. Signed in as {email ?? 'unknown'}.
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          className="input"
          style={{ maxWidth: 300 }}
          placeholder="e.g. Christian"
          value={name}
          onChange={e => setName(e.target.value)}
          aria-label="Your name"
        />
        <button type="submit" className="btn btn-primary" disabled={saving || name.trim() === (fullName ?? '')}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saved && <span style={{ fontSize: 13, color: '#2f7d4a' }}>Saved</span>}
        {error && <span style={{ fontSize: 13, color: '#e03c3c' }}>{error}</span>}
      </div>
    </form>
  )
}
