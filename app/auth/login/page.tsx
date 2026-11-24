'use client'

import { Suspense, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'

// useSearchParams needs a Suspense boundary (see Next docs: use-search-params).
export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}

function LoginForm() {
  const deactivated = useSearchParams().get('deactivated') === '1'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const supabase = createClient()
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        // A deactivated user is banned in Supabase Auth; say so plainly rather than "User is banned".
        setError(/banned/i.test(error.message) ? 'This account has been deactivated. Contact your Maintenance Hub admin.' : error.message)
        setLoading(false)
      } else {
        router.push('/dashboard')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#f7f7f5',
    }}>
      <div style={{
        background: 'white',
        borderRadius: 10,
        boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
        padding: '40px 36px',
        width: '100%',
        maxWidth: 380,
      }}>
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, color: '#37352f', marginBottom: 4 }}>
            Maintenance Hub
          </h1>
          <p style={{ color: '#787774', fontSize: 14 }}>Sign in to your account</p>
        </div>

        {deactivated && !error && (
          <p role="alert" style={{ color: '#9a6700', fontSize: 13, background: '#fdf5e0', padding: '10px 12px', borderRadius: 6, margin: '0 0 16px' }}>
            Your account has been deactivated, so you&apos;ve been signed out. If you think this is a mistake, contact your Maintenance Hub admin.
          </p>
        )}

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 5, color: '#37352f' }}>
              Email
            </label>
            <input
              type="email"
              className="input"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              placeholder="you@example.com"
              autoComplete="email"
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 5, color: '#37352f' }}>
              Password
            </label>
            <input
              type="password"
              className="input"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>

          {error && (
            <p style={{ color: '#e03c3c', fontSize: 13, background: '#fff1f1', padding: '8px 12px', borderRadius: 6 }}>
              {error}
            </p>
          )}

          <button type="submit" className="btn btn-primary" disabled={loading} style={{ marginTop: 4, justifyContent: 'center' }}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
