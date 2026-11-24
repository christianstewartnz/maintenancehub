'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { UserPlus, Pencil } from 'lucide-react'
import type { StaffProfile, UserRole } from '@/lib/types'

export type TeamUser = StaffProfile & {
  /** Hasn't signed in yet (invite not accepted). */
  invitePending: boolean
  lastSignInAt: string | null
}
type StaffRow = { project_id: string; user_id: string; is_primary: boolean }
type ProjectRow = { id: string; name: string; status: string }

interface Props {
  currentUserId: string
  users: TeamUser[]
  staff: StaffRow[]
  projects: ProjectRow[]
}

/** Calls an admin API route; returns the JSON body or throws its error message. */
async function call(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error ?? 'Something went wrong')
  return json
}

function displayName(u: Pick<StaffProfile, 'full_name' | 'email'>) {
  return u.full_name || u.email || 'Unnamed user'
}

const label: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 5 }

/** Settings → Team (admins only): users, roles, activation and project assignments. */
export default function TeamCard({ currentUserId, users, staff, projects }: Props) {
  const [inviting, setInviting] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const editing = users.find(u => u.id === editingId) ?? null

  const sorted = [...users].sort((a, b) =>
    Number(b.is_active) - Number(a.is_active) || displayName(a).localeCompare(displayName(b)))

  return (
    <div style={{ maxWidth: 960, border: '1px solid #e9e9e7', borderRadius: 8, padding: '20px 24px', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 600 }}>Team</h3>
          <p style={{ color: '#787774', fontSize: 14, margin: 0 }}>
            Admins see everything. Staff only see the projects they&apos;re assigned to. Items with no Responsible person go to the project&apos;s main contact.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setInviting(true)}>
          <UserPlus size={14} /> Invite user
        </button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="data-table" style={{ marginBottom: 0 }}>
          <thead>
            <tr><th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th>Status</th><th>Projects</th><th></th></tr>
          </thead>
          <tbody>
            {sorted.map(u => {
              const mine = staff.filter(s => s.user_id === u.id)
              const primary = mine.filter(s => s.is_primary).length
              return (
                <tr key={u.id} style={{ opacity: u.is_active ? 1 : 0.6 }}>
                  <td style={{ fontWeight: 500 }}>
                    {u.full_name || <span style={{ color: '#9b9a97' }}>—</span>}
                    {u.id === currentUserId && <span style={{ color: '#787774', fontWeight: 400 }}> (you)</span>}
                  </td>
                  <td style={{ fontSize: 13 }}>{u.email}</td>
                  <td style={{ fontSize: 13 }}>{u.phone || <span style={{ color: '#9b9a97' }}>—</span>}</td>
                  <td><span className={`badge ${u.role === 'admin' ? 'badge-blue' : 'badge-gray'}`}>{u.role === 'admin' ? 'Admin' : 'Staff'}</span></td>
                  <td>
                    {!u.is_active
                      ? <span className="badge badge-orange">Deactivated</span>
                      : u.invitePending
                        ? <span className="badge badge-amber">Invite pending</span>
                        : <span className="badge badge-green-light">Active</span>}
                  </td>
                  <td style={{ fontSize: 13, color: '#37352f' }}>
                    {u.role === 'admin' && !mine.length
                      ? <span style={{ color: '#787774' }}>All (admin)</span>
                      : <>{mine.length} project{mine.length !== 1 ? 's' : ''}{primary > 0 && <span style={{ color: '#787774' }}> · main contact on {primary}</span>}</>}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button type="button" className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: 13 }} onClick={() => setEditingId(u.id)}>
                      <Pencil size={13} /> Edit
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {inviting && <InviteModal projects={projects} onClose={() => setInviting(false)} />}
      {editing && (
        <EditUserModal
          user={editing}
          isSelf={editing.id === currentUserId}
          users={users}
          staff={staff}
          projects={projects}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  )
}

/** Shows a set-password link with a copy button, for when the email didn't go or didn't arrive. */
function LinkResult({ result }: { result: { link: string; emailed: boolean; emailError: string | null; to: string } }) {
  const [copied, setCopied] = useState(false)
  return (
    <div style={{ background: result.emailed ? '#f0f8f2' : '#fdf5e0', borderRadius: 6, padding: '10px 12px', fontSize: 13 }}>
      <p style={{ margin: '0 0 8px' }}>
        {result.emailed
          ? <>Emailed a set-password link to <strong>{result.to}</strong>.</>
          : <>The email wasn&apos;t sent ({result.emailError}). Copy this link and send it to <strong>{result.to}</strong> yourself:</>}
      </p>
      <div style={{ display: 'flex', gap: 6 }}>
        <input className="input" readOnly value={result.link} onFocus={e => e.target.select()} style={{ fontSize: 12 }} aria-label="Set-password link" />
        <button
          type="button"
          className="btn btn-secondary"
          onClick={async () => { await navigator.clipboard.writeText(result.link).catch(() => {}); setCopied(true) }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p style={{ margin: '6px 0 0', color: '#787774', fontSize: 12 }}>The link works once. Treat it like a password.</p>
    </div>
  )
}

function InviteModal({ projects, onClose }: { projects: ProjectRow[]; onClose: () => void }) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState<UserRole>('staff')
  const [projectIds, setProjectIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ link: string; emailed: boolean; emailError: string | null; to: string } | null>(null)
  const active = projects.filter(p => p.status === 'active')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const json = await call('/api/admin/users', 'POST', {
        email, full_name: name, phone, role, project_ids: projectIds,
      })
      setResult({ link: json.link, emailed: json.emailed, emailError: json.emailError, to: email.trim().toLowerCase() })
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invite failed')
    }
    setBusy(false)
  }

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <form className="modal" onClick={e => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-header">
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Invite user</h2>
          <button type="button" className="btn btn-ghost" style={{ padding: '4px 8px' }} onClick={onClose} disabled={busy}>✕</button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {result ? <LinkResult result={result} /> : <>
            <p style={{ margin: 0, fontSize: 14, color: '#787774' }}>
              They&apos;ll get an email with a link to choose their password, then they&apos;re signed in.
            </p>
            <div>
              <label htmlFor="inv-email" style={label}>Email</label>
              <input id="inv-email" className="input" type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="name@stratum-mgt.co.nz" />
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 200px' }}>
                <label htmlFor="inv-name" style={label}>Name</label>
                <input id="inv-name" className="input" value={name} maxLength={100} onChange={e => setName(e.target.value)} />
              </div>
              <div style={{ flex: '1 1 160px' }}>
                <label htmlFor="inv-phone" style={label}>Phone <span style={{ color: '#787774', fontWeight: 400 }}>(optional)</span></label>
                <input id="inv-phone" className="input" type="tel" value={phone} maxLength={40} onChange={e => setPhone(e.target.value)} />
              </div>
            </div>
            <div>
              <label htmlFor="inv-role" style={label}>Role</label>
              <select id="inv-role" className="input" style={{ width: 240 }} value={role} onChange={e => setRole(e.target.value as UserRole)}>
                <option value="staff">Staff: only their projects</option>
                <option value="admin">Admin: everything</option>
              </select>
            </div>
            <div>
              <span style={label}>Projects</span>
              {active.length === 0
                ? <p style={{ margin: 0, fontSize: 13, color: '#787774' }}>No active projects.</p>
                : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto', border: '1px solid #e9e9e7', borderRadius: 6, padding: '8px 10px' }}>
                    {active.map(p => (
                      <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={projectIds.includes(p.id)}
                          onChange={() => setProjectIds(ids => ids.includes(p.id) ? ids.filter(i => i !== p.id) : [...ids, p.id])}
                          style={{ accentColor: '#2383e2' }}
                        />
                        {p.name}
                      </label>
                    ))}
                  </div>
                )}
              <p style={{ margin: '4px 0 0', fontSize: 12, color: '#787774' }}>You can change projects and main contacts later.</p>
            </div>
            {error && <p style={{ color: '#e03c3c', fontSize: 13, margin: 0 }}>{error}</p>}
          </>}
        </div>
        <div className="modal-footer">
          {result
            ? <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
            : <>
              <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={busy || !email.trim()}>
                {busy ? 'Inviting…' : 'Send invite'}
              </button>
            </>}
        </div>
      </form>
    </div>
  )
}

function EditUserModal({ user, isSelf, users, staff, projects, onClose }: {
  user: TeamUser
  isSelf: boolean
  users: TeamUser[]
  staff: StaffRow[]
  projects: ProjectRow[]
  onClose: () => void
}) {
  const router = useRouter()
  const [name, setName] = useState(user.full_name ?? '')
  const [phone, setPhone] = useState(user.phone ?? '')
  const [role, setRole] = useState<UserRole>(user.role)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [linkResult, setLinkResult] = useState<{ link: string; emailed: boolean; emailError: string | null; to: string } | null>(null)

  const nameOf = new Map(users.map(u => [u.id, displayName(u)]))
  const mine = new Map(staff.filter(s => s.user_id === user.id).map(s => [s.project_id, s]))
  const primaryOf = new Map(staff.filter(s => s.is_primary).map(s => [s.project_id, s.user_id]))
  // Active projects, plus any archived ones they're still on.
  const shown = projects.filter(p => p.status === 'active' || mine.has(p.id))
  const dirty = name.trim() !== (user.full_name ?? '') || phone.trim() !== (user.phone ?? '') || role !== user.role

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key)
    setError(null)
    try {
      await fn()
      router.refresh()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      return false
    } finally {
      setBusy(null)
    }
  }

  async function saveDetails(e: React.FormEvent) {
    e.preventDefault()
    const ok = await run('details', () => call(`/api/admin/users/${user.id}`, 'PATCH', {
      full_name: name, phone, ...(role !== user.role ? { role } : {}),
    }))
    if (ok) { setSaved(true); setTimeout(() => setSaved(false), 3000) }
  }

  function toggleProject(projectId: string) {
    const row = mine.get(projectId)
    if (row?.is_primary && !confirm(`${displayName(user)} is the main contact for this project. Remove them anyway? The project will have no main contact until you choose one.`)) return
    run(`p:${projectId}`, () => call('/api/admin/project-staff', row ? 'DELETE' : 'POST', { project_id: projectId, user_id: user.id }))
  }

  function togglePrimary(projectId: string) {
    const row = mine.get(projectId)
    run(`p:${projectId}`, () => row
      ? call('/api/admin/project-staff', 'PATCH', { project_id: projectId, user_id: user.id, is_primary: !row.is_primary })
      : call('/api/admin/project-staff', 'POST', { project_id: projectId, user_id: user.id, is_primary: true }))
  }

  async function setActive(active: boolean) {
    if (!active) {
      const contactFor = shown.filter(p => mine.get(p.id)?.is_primary).map(p => p.name)
      const extra = contactFor.length
        ? `\n\nThey're the main contact for: ${contactFor.join(', ')}. Choose a new main contact for those projects afterwards.`
        : ''
      if (!confirm(`Deactivate ${displayName(user)}? They'll be signed out and can't sign in until reactivated.${extra}`)) return
    }
    await run('active', () => call(`/api/admin/users/${user.id}`, 'PATCH', { is_active: active }))
  }

  async function sendLink() {
    setLinkResult(null)
    await run('link', async () => {
      const json = await call(`/api/admin/users/${user.id}/invite`, 'POST')
      setLinkResult({ link: json.link, emailed: json.emailed, emailError: json.emailError, to: json.to })
    })
  }

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{displayName(user)}</h2>
            <div style={{ fontSize: 13, color: '#787774', marginTop: 2 }}>
              {user.email}
              {!user.is_active ? ' · Deactivated' : user.invitePending ? ' · Invite pending' : ''}
            </div>
          </div>
          <button type="button" className="btn btn-ghost" style={{ padding: '4px 8px' }} onClick={onClose} disabled={!!busy}>✕</button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Details */}
          <form onSubmit={saveDetails}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ flex: '1 1 180px' }}>
                <label htmlFor="ed-name" style={label}>Name</label>
                <input id="ed-name" className="input" value={name} maxLength={100} onChange={e => setName(e.target.value)} />
              </div>
              <div style={{ flex: '1 1 150px' }}>
                <label htmlFor="ed-phone" style={label}>Phone</label>
                <input id="ed-phone" className="input" type="tel" value={phone} maxLength={40} onChange={e => setPhone(e.target.value)} />
              </div>
              <div style={{ flex: '0 0 130px' }}>
                <label htmlFor="ed-role" style={label}>Role</label>
                <select
                  id="ed-role"
                  className="input"
                  value={role}
                  onChange={e => setRole(e.target.value as UserRole)}
                  disabled={isSelf}
                  title={isSelf ? "You can't change your own role" : undefined}
                >
                  <option value="staff">Staff</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <button type="submit" className="btn btn-primary" disabled={!!busy || !dirty}>
                {busy === 'details' ? 'Saving…' : 'Save'}
              </button>
            </div>
            {saved && <p style={{ margin: '6px 0 0', fontSize: 13, color: '#2f7d4a' }}>Saved</p>}
          </form>

          {/* Projects */}
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Projects</div>
            <p style={{ margin: '0 0 8px', fontSize: 13, color: '#787774' }}>
              {user.role === 'admin'
                ? 'Admins can see every project anyway; assign them where they should be a contact.'
                : 'They only see the projects ticked here.'}
            </p>
            {shown.length === 0 ? (
              <p style={{ margin: 0, fontSize: 13, color: '#787774' }}>No active projects.</p>
            ) : (
              <div style={{ border: '1px solid #e9e9e7', borderRadius: 6, maxHeight: 300, overflowY: 'auto' }}>
                {shown.map(p => {
                  const row = mine.get(p.id)
                  const primaryId = primaryOf.get(p.id)
                  const other = primaryId && primaryId !== user.id ? nameOf.get(primaryId) : null
                  const pBusy = busy === `p:${p.id}`
                  return (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderTop: '1px solid #f1f1ef' }}>
                      <input
                        type="checkbox"
                        checked={!!row}
                        disabled={!!busy || (!row && !user.is_active)}
                        onChange={() => toggleProject(p.id)}
                        aria-label={`Assign to ${p.name}`}
                        style={{ accentColor: '#2383e2', width: 16, height: 16 }}
                      />
                      <span style={{ flex: 1, fontSize: 14, minWidth: 0 }}>
                        {p.name}
                        {p.status !== 'active' && <span style={{ color: '#9b9a97', fontSize: 12 }}> (archived)</span>}
                        {other && <span style={{ color: '#9b9a97', fontSize: 12 }}> · main contact: {other}</span>}
                      </span>
                      {row?.is_primary
                        ? (
                          <button type="button" className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: 12 }} disabled={!!busy}
                            onClick={() => togglePrimary(p.id)} title="Stop being the main contact">
                            <span className="badge badge-blue">Main contact</span>
                          </button>
                        )
                        : (
                          <button type="button" className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: 12, color: '#787774' }}
                            disabled={!!busy || !user.is_active} onClick={() => togglePrimary(p.id)}>
                            {pBusy ? 'Saving…' : 'Make main contact'}
                          </button>
                        )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Account */}
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Account</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {user.is_active && (
                <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={sendLink}>
                  {busy === 'link' ? 'Sending…' : user.invitePending ? 'Resend invite' : 'Send set-password link'}
                </button>
              )}
              {!isSelf && (user.is_active
                ? <button type="button" className="btn btn-danger" disabled={!!busy} onClick={() => setActive(false)}>
                    {busy === 'active' ? 'Deactivating…' : 'Deactivate'}
                  </button>
                : <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => setActive(true)}>
                    {busy === 'active' ? 'Reactivating…' : 'Reactivate'}
                  </button>)}
            </div>
            {linkResult && <div style={{ marginTop: 10 }}><LinkResult result={linkResult} /></div>}
          </div>

          {error && <p style={{ color: '#e03c3c', fontSize: 13, margin: 0 }}>{error}</p>}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={!!busy}>Close</button>
        </div>
      </div>
    </div>
  )
}
