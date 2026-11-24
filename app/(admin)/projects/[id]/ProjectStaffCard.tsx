'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Mail, Phone, X } from 'lucide-react'
import type { ProjectStaff, StaffProfile } from '@/lib/types'

/**
 * Who looks after this project. Admins add/remove staff and pick the main contact
 * (items with no Responsible person go to them); staff see it read-only.
 */
export default function ProjectStaffCard({ projectId, staff, canEdit, people }: {
  projectId: string
  staff: ProjectStaff[]
  canEdit: boolean
  /** Active users who could be added (admins only). */
  people: StaffProfile[]
}) {
  const router = useRouter()
  const [adding, setAdding] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const rows = [...staff]
    .filter(s => s.profile)
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary)
      || (a.profile!.full_name ?? a.profile!.email ?? '').localeCompare(b.profile!.full_name ?? b.profile!.email ?? ''))
  const onProject = new Set(staff.map(s => s.user_id))
  const addable = people.filter(p => !onProject.has(p.id))
  const hasPrimary = staff.some(s => s.is_primary)

  async function call(key: string, method: string, body: Record<string, unknown>) {
    setBusy(key)
    setError(null)
    const res = await fetch('/api/admin/project-staff', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: projectId, ...body }),
    })
    const json = await res.json().catch(() => ({}))
    setBusy(null)
    if (!res.ok) { setError(json.error ?? 'Something went wrong'); return false }
    router.refresh()
    return true
  }

  async function add() {
    if (!adding) return
    // The first person added becomes the main contact if there isn't one.
    if (await call('add', 'POST', { user_id: adding, is_primary: !hasPrimary })) setAdding('')
  }

  function remove(s: ProjectStaff) {
    const name = s.profile?.full_name || s.profile?.email || 'this person'
    const msg = s.is_primary
      ? `Remove ${name}? They're the main contact, so the project will have no main contact until you choose another.`
      : `Remove ${name} from this project? They'll no longer see it.`
    if (confirm(msg)) call(`rm:${s.user_id}`, 'DELETE', { user_id: s.user_id })
  }

  return (
    <div style={{ padding: '0 32px 16px' }}>
      <div style={{ border: '1px solid #e9e9e7', borderRadius: 8, padding: 16 }}>
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Staff</div>
          <div style={{ fontSize: 13, color: '#787774', marginTop: 2 }}>
            People who look after this project. Items with no Responsible person go to the main contact.
          </div>
        </div>

        {error && <div style={{ fontSize: 13, color: '#eb5757', marginBottom: 8 }}>{error}</div>}

        {rows.length === 0 ? (
          <div style={{ fontSize: 13, color: '#787774' }}>No staff assigned{canEdit ? ' yet' : ''}.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {rows.map(s => {
              const p = s.profile!
              return (
                <div key={s.user_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid #f1f1ef', flexWrap: 'wrap', opacity: p.is_active ? 1 : 0.6 }}>
                  <span style={{ fontSize: 14, fontWeight: 500, minWidth: 140 }}>
                    {p.full_name || p.email}
                    {!p.is_active && <span style={{ color: '#9b9a97', fontWeight: 400, fontSize: 12 }}> (deactivated)</span>}
                  </span>
                  {s.is_primary && <span className="badge badge-blue">Main contact</span>}
                  <span style={{ flex: 1, display: 'flex', gap: 14, fontSize: 13, color: '#787774', flexWrap: 'wrap', minWidth: 0 }}>
                    {p.phone && <a href={`tel:${p.phone.replace(/[^0-9+]/g, '')}`} style={{ color: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Phone size={12} />{p.phone}</a>}
                    {p.email && <a href={`mailto:${p.email}`} style={{ color: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Mail size={12} />{p.email}</a>}
                  </span>
                  {canEdit && (
                    <>
                      {!s.is_primary && p.is_active && (
                        <button className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 8px', color: '#787774' }} disabled={!!busy}
                          onClick={() => call(`pr:${s.user_id}`, 'PATCH', { user_id: s.user_id, is_primary: true })}>
                          {busy === `pr:${s.user_id}` ? 'Saving…' : 'Make main contact'}
                        </button>
                      )}
                      <button className="btn btn-ghost" style={{ padding: 6, color: '#eb5757' }} disabled={!!busy} onClick={() => remove(s)} title="Remove from project">
                        <X size={14} />
                      </button>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {canEdit && (
          <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <select className="input" style={{ width: 260, maxWidth: '100%' }} value={adding} onChange={e => setAdding(e.target.value)} disabled={!!busy || !addable.length} aria-label="Add staff member">
              <option value="">{addable.length ? 'Add someone…' : 'Everyone is already on this project'}</option>
              {addable.map(p => (
                <option key={p.id} value={p.id}>{p.full_name || p.email}{p.role === 'admin' ? ' (admin)' : ''}</option>
              ))}
            </select>
            <button className="btn btn-secondary" disabled={!!busy || !adding} onClick={add}>
              {busy === 'add' ? 'Adding…' : 'Add'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
