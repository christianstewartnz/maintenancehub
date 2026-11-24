'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const MIN_LENGTH = 8

/** Change your own password (you're already signed in, so Supabase only needs the new one). */
export default function ChangePasswordCard() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < MIN_LENGTH) { setMsg({ ok: false, text: `Use at least ${MIN_LENGTH} characters.` }); return }
    if (password !== confirm) { setMsg({ ok: false, text: 'The two passwords don’t match.' }); return }
    setBusy(true)
    setMsg(null)
    const { error } = await createClient().auth.updateUser({ password })
    setBusy(false)
    if (error) { setMsg({ ok: false, text: error.message }); return }
    setPassword('')
    setConfirm('')
    setMsg({ ok: true, text: 'Password changed' })
  }

  return (
    <form onSubmit={save} style={{ maxWidth: 640, border: '1px solid #e9e9e7', borderRadius: 8, padding: '20px 24px', marginBottom: 16 }}>
      <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 600 }}>Password</h3>
      <p style={{ color: '#787774', fontSize: 14, marginTop: 0, marginBottom: 16 }}>Change the password you sign in with.</p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div>
          <label htmlFor="pw-new" style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 5 }}>New password</label>
          <input id="pw-new" className="input" type="password" autoComplete="new-password" style={{ width: 220, maxWidth: '100%' }}
            value={password} onChange={e => setPassword(e.target.value)} />
        </div>
        <div>
          <label htmlFor="pw-confirm" style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 5 }}>Confirm new password</label>
          <input id="pw-confirm" className="input" type="password" autoComplete="new-password" style={{ width: 220, maxWidth: '100%' }}
            value={confirm} onChange={e => setConfirm(e.target.value)} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="submit" className="btn btn-secondary" disabled={busy || !password || !confirm}>
          {busy ? 'Saving…' : 'Change password'}
        </button>
        {msg && <span style={{ fontSize: 13, color: msg.ok ? '#2f7d4a' : '#e03c3c' }}>{msg.text}</span>}
      </div>
    </form>
  )
}
