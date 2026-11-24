'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'

/**
 * Where invite and set-password links land: /auth/accept-invite?token_hash=…&type=invite|recovery
 * (built by app/api/admin/_lib/invite.ts).
 *
 * The token is only redeemed (verifyOtp) when the user submits their new password,
 * not on page load, so email link scanners that open the URL first can't use it up.
 * verifyOtp signs them in (the browser client stores the session in cookies), then
 * updateUser sets the password, then they go to the dashboard.
 */
export default function AcceptInvitePage() {
  return (
    <Suspense>
      <AcceptInviteForm />
    </Suspense>
  )
}

const MIN_LENGTH = 8

function AcceptInviteForm() {
  const params = useSearchParams()
  const tokenHash = params.get('token_hash')
  const type: EmailOtpType = params.get('type') === 'recovery' ? 'recovery' : 'invite'
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  // After a successful verify the token is spent; a retry (e.g. too-weak password) only re-tries the password.
  const [verifiedAs, setVerifiedAs] = useState<string | null>(null)
  const router = useRouter()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < MIN_LENGTH) { setError(`Use at least ${MIN_LENGTH} characters.`); return }
    if (password !== confirm) { setError('The two passwords don’t match.'); return }

    setLoading(true)
    const supabase = createClient()
    try {
      if (!verifiedAs) {
        if (!tokenHash) { setError('This link is incomplete. Open it again from your email.'); setLoading(false); return }
        const { data, error: vErr } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
        if (vErr || !data.session) {
          setError(/banned/i.test(vErr?.message ?? '')
            ? 'This account has been deactivated. Contact your Maintenance Hub admin.'
            : 'This link has expired or has already been used. Ask your admin to send you a new one.')
          setLoading(false)
          return
        }
        setVerifiedAs(data.user?.email ?? '')
      }
      const { error: pErr } = await supabase.auth.updateUser({ password })
      if (pErr) { setError(pErr.message); setLoading(false); return }
      router.replace('/dashboard')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setLoading(false)
    }
  }

  const label: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 5, color: '#37352f' }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f7f7f5', padding: 16 }}>
      <div style={{ background: 'white', borderRadius: 10, boxShadow: '0 4px 24px rgba(0,0,0,0.08)', padding: '40px 36px', width: '100%', maxWidth: 380 }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, color: '#37352f', marginBottom: 4 }}>Maintenance Hub</h1>
          <p style={{ color: '#787774', fontSize: 14 }}>
            {type === 'invite' ? 'Welcome! Choose a password to finish setting up your account.' : 'Choose a new password.'}
          </p>
          {verifiedAs && <p style={{ color: '#787774', fontSize: 13, marginTop: 6 }}>Signed in as {verifiedAs}.</p>}
        </div>

        {!tokenHash && !verifiedAs ? (
          <p style={{ color: '#e03c3c', fontSize: 13, background: '#fff1f1', padding: '8px 12px', borderRadius: 6 }}>
            This link is incomplete. Open it again from your email, or ask your admin to send a new one.
          </p>
        ) : (
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label htmlFor="new-password" style={label}>New password</label>
              <input id="new-password" type="password" className="input" value={password} onChange={e => setPassword(e.target.value)}
                required minLength={MIN_LENGTH} autoComplete="new-password" autoFocus />
            </div>
            <div>
              <label htmlFor="confirm-password" style={label}>Confirm password</label>
              <input id="confirm-password" type="password" className="input" value={confirm} onChange={e => setConfirm(e.target.value)}
                required minLength={MIN_LENGTH} autoComplete="new-password" />
            </div>

            {error && (
              <p style={{ color: '#e03c3c', fontSize: 13, background: '#fff1f1', padding: '8px 12px', borderRadius: 6 }}>{error}</p>
            )}

            <button type="submit" className="btn btn-primary" disabled={loading} style={{ marginTop: 4, justifyContent: 'center' }}>
              {loading ? 'Saving…' : type === 'invite' ? 'Set password and sign in' : 'Save password and sign in'}
            </button>
          </form>
        )}

        <p style={{ marginTop: 20, fontSize: 13, color: '#787774', textAlign: 'center' }}>
          Already have a password? <a href="/auth/login" style={{ color: '#2383e2' }}>Sign in</a>
        </p>
      </div>
    </div>
  )
}
