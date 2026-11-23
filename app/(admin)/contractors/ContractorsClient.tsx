'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Plus, Copy, Check, ExternalLink, Pencil, Mail } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { Contractor } from '@/lib/types'
import NotifyContractorModal, { type PendingNotifyItem } from '@/components/ui/NotifyContractorModal'
import { COUNTS_CHANGED_EVENT } from '@/lib/contractor-notify'

export type PendingRow = PendingNotifyItem & { contractor_id: string }

interface Props { contractors: Contractor[]; pendingItems: PendingRow[] }

const emptyForm = { company_name: '', contact_name: '', email: '', phone: '', notes: '' }

export default function ContractorsClient({ contractors: initial, pendingItems: initialPending }: Props) {
  const [contractors, setContractors] = useState(initial)
  const [pending, setPending] = useState(initialPending)
  const [notifying, setNotifying] = useState<Contractor | null>(null)
  const [showNotifyAll, setShowNotifyAll] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const pendingFor = (id: string) => pending.filter(p => p.contractor_id === id)
  const pendingCounts: Record<string, number> = {}
  for (const p of pending) pendingCounts[p.contractor_id] = (pendingCounts[p.contractor_id] ?? 0) + 1

  // Only contractors with new items and an email address can be bulk-notified.
  const canSelect = (c: Contractor) => !!pendingCounts[c.id] && !!c.email
  const selectedContractors = contractors.filter(c => selected.has(c.id) && canSelect(c))
  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function setSelectedMany(ids: string[], on: boolean) {
    setSelected(prev => {
      const next = new Set(prev)
      for (const id of ids) {
        if (on) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }

  function clearPending(ids: string[]) {
    const set = new Set(ids)
    setPending(prev => prev.filter(p => !set.has(p.id)))
    router.refresh()
  }
  const [showModal, setShowModal] = useState(false)
  const [editingContractor, setEditingContractor] = useState<Contractor | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [saving, setSaving] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [editForm, setEditForm] = useState(emptyForm)
  const router = useRouter()
  const supabase = createClient()

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const { data } = await supabase.from('contractors').insert({
      company_name: form.company_name,
      contact_name: form.contact_name || null,
      email: form.email || null,
      phone: form.phone || null,
      notes: form.notes || null,
    }).select().single()
    if (data) {
      setContractors(prev => [...prev, data].sort((a, b) => a.company_name.localeCompare(b.company_name)))
      setShowModal(false)
      setForm(emptyForm)
    }
    setSaving(false)
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editingContractor) return
    setSaving(true)
    const { data } = await supabase.from('contractors').update({
      company_name: editForm.company_name,
      contact_name: editForm.contact_name || null,
      email: editForm.email || null,
      phone: editForm.phone || null,
      notes: editForm.notes || null,
    }).eq('id', editingContractor.id).select().single()
    if (data) {
      setContractors(prev => prev.map(c => c.id === data.id ? data : c).sort((a, b) => a.company_name.localeCompare(b.company_name)))
      setEditingContractor(null)
      router.refresh()
    }
    setSaving(false)
  }

  function openEdit(c: Contractor) {
    setEditForm({
      company_name: c.company_name,
      contact_name: c.contact_name ?? '',
      email: c.email ?? '',
      phone: c.phone ?? '',
      notes: c.notes ?? '',
    })
    setEditingContractor(c)
  }

  function copyPortalLink(contractor: Contractor) {
    const url = `${window.location.origin}/portal/${contractor.portal_token}`
    navigator.clipboard.writeText(url)
    setCopiedId(contractor.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  return (
    <div className="page-content" style={{ padding: '24px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        {pending.length > 0 && (
          <button
            className={selectedContractors.length ? 'btn btn-primary' : 'btn btn-secondary'}
            onClick={() => setShowNotifyAll(true)}
            disabled={selectedContractors.length === 0}
            title={selectedContractors.length ? undefined : 'Tick the contractors you want to email'}
          >
            <Mail size={15} /> Notify selected ({selectedContractors.length})
          </button>
        )}
        <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={16} /> New Contractor</button>
      </div>

      {contractors.length === 0 ? (
        <div className="empty-state">
          <p style={{ fontSize: 15, fontWeight: 500 }}>No contractors yet</p>
          <p>Add your first contractor to get started.</p>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setShowModal(true)}><Plus size={16} /> Add Contractor</button>
        </div>
      ) : (
        <>
          <ContractorTable
            contractors={contractors.filter(c => c.is_active !== false)}
            copiedId={copiedId}
            onCopy={copyPortalLink}
            onEdit={openEdit}
            pendingCounts={pendingCounts}
            onNotify={setNotifying}
            selected={selected}
            canSelect={canSelect}
            onToggle={toggleSelect}
            onToggleMany={setSelectedMany}
          />
          {contractors.some(c => c.is_active === false) && (
            <div style={{ marginTop: 24 }}>
              <button
                className="btn btn-ghost"
                style={{ fontSize: 13, color: '#787774', padding: '4px 0' }}
                onClick={() => setShowArchived(s => !s)}
              >
                {showArchived
                  ? `Hide archived (${contractors.filter(c => c.is_active === false).length})`
                  : `Show archived (${contractors.filter(c => c.is_active === false).length})`}
              </button>
              {showArchived && (
                <div style={{ marginTop: 12, opacity: 0.6 }}>
                  <ContractorTable
                    contractors={contractors.filter(c => c.is_active === false)}
                    copiedId={copiedId}
                    onCopy={copyPortalLink}
                    onEdit={openEdit}
                    pendingCounts={pendingCounts}
                    onNotify={setNotifying}
                    selected={selected}
                    canSelect={canSelect}
                    onToggle={toggleSelect}
                    onToggleMany={setSelectedMany}
                    dimmed
                  />
                </div>
              )}
            </div>
          )}
        </>
      )}

      {notifying && (
        <NotifyContractorModal
          contractor={notifying}
          items={pendingFor(notifying.id)}
          onClose={() => setNotifying(null)}
          onDone={ids => { clearPending(ids); setNotifying(null) }}
        />
      )}

      {showNotifyAll && (
        <NotifyAllModal
          contractors={selectedContractors}
          pendingFor={pendingFor}
          onClose={() => setShowNotifyAll(false)}
          onSent={(ids, contractorId) => { clearPending(ids); setSelectedMany([contractorId], false) }}
        />
      )}

      {/* Create modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>New Contractor</h2>
              <button className="btn btn-ghost" style={{ padding: '4px 8px' }} onClick={() => setShowModal(false)}>✕</button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <Field label="Company name *"><input className="input" required value={form.company_name} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} placeholder="e.g. ABC Plumbing" /></Field>
                <Field label="Contact name"><input className="input" value={form.contact_name} onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))} /></Field>
                <Field label="Email"><input className="input" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></Field>
                <Field label="Phone"><input className="input" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} /></Field>
                <Field label="Notes"><textarea className="input" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Reliability notes, rates, etc." /></Field>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Create Contractor'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editingContractor && (
        <div className="modal-overlay" onClick={() => setEditingContractor(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Edit Contractor</h2>
              <button className="btn btn-ghost" style={{ padding: '4px 8px' }} onClick={() => setEditingContractor(null)}>✕</button>
            </div>
            <form onSubmit={handleEdit}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <Field label="Company name *"><input className="input" required value={editForm.company_name} onChange={e => setEditForm(f => ({ ...f, company_name: e.target.value }))} /></Field>
                <Field label="Contact name"><input className="input" value={editForm.contact_name} onChange={e => setEditForm(f => ({ ...f, contact_name: e.target.value }))} /></Field>
                <Field label="Email"><input className="input" type="email" value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} /></Field>
                <Field label="Phone"><input className="input" value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} /></Field>
                <Field label="Notes"><textarea className="input" value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} placeholder="Reliability notes, rates, etc." /></Field>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setEditingContractor(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 5, color: '#37352f' }}>{label}</label>
      {children}
    </div>
  )
}

function NotifyAllModal({ contractors, pendingFor, onClose, onSent }: {
  contractors: Contractor[]
  pendingFor: (id: string) => PendingRow[]
  onClose: () => void
  onSent: (ids: string[], contractorId: string) => void
}) {
  // Freeze the list when the dialog opens, so rows stay visible as each one is sent.
  const [list] = useState(contractors)
  type Result = 'sent' | 'skipped' | string
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<Record<string, Result>>({})
  const [message, setMessage] = useState('')
  const sendable = list.filter(c => c.email)
  const done = Object.keys(results).length > 0 && !running

  async function sendAll() {
    setRunning(true)
    for (const c of sendable) {
      const ids = pendingFor(c.id).map(i => i.id)
      const res = await fetch(`/api/contractors/${c.id}/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'email', item_ids: ids, message: message.trim() || undefined }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok) {
        onSent(ids, c.id)
        window.dispatchEvent(new Event(COUNTS_CHANGED_EVENT))
      }
      setResults(prev => ({ ...prev, [c.id]: res.ok ? 'sent' : (json.error ?? 'Failed') }))
    }
    setRunning(false)
  }

  return (
    <div className="modal-overlay" onClick={() => !running && onClose()}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Notify selected contractors</h2>
          <button className="btn btn-ghost" style={{ padding: '4px 8px' }} onClick={onClose} disabled={running}>✕</button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ margin: 0, fontSize: 14 }}>
            Each contractor below gets one email listing their new items and their portal link.
          </p>
          <table className="data-table" style={{ marginBottom: 0 }}>
            <thead><tr><th>Contractor</th><th>Email</th><th style={{ textAlign: 'right' }}>New</th><th></th></tr></thead>
            <tbody>
              {list.map(c => {
                const r = results[c.id]
                return (
                  <tr key={c.id} style={{ opacity: c.email ? 1 : 0.55 }}>
                    <td style={{ fontWeight: 500 }}>{c.company_name}</td>
                    <td style={{ fontSize: 13, color: '#787774' }}>{c.email ?? 'No email — skipped'}</td>
                    <td style={{ textAlign: 'right', fontSize: 13 }}>{pendingFor(c.id).length || '—'}</td>
                    <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                      {r === 'sent' && <span style={{ color: '#0f7b6c' }}>✓ Sent</span>}
                      {r && r !== 'sent' && <span style={{ color: '#e03131' }} title={r}>Failed</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div>
            <label htmlFor="notify-all-message" style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 5 }}>
              Note to contractors <span style={{ color: '#787774', fontWeight: 400 }}>(optional)</span>
            </label>
            <textarea
              id="notify-all-message"
              className="input"
              rows={3}
              value={message}
              onChange={e => setMessage(e.target.value)}
              disabled={running || done}
              maxLength={4000}
              placeholder="Added to every email above, under the greeting."
              style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit', fontSize: 14 }}
            />
          </div>
          {Object.values(results).some(r => r !== 'sent') && (
            <p style={{ margin: 0, fontSize: 13, color: '#e03131' }}>
              {Object.entries(results).filter(([, r]) => r !== 'sent').map(([id, r]) => `${list.find(c => c.id === id)?.company_name}: ${r}`).join(' · ')}
            </p>
          )}
        </div>
        <div className="modal-footer">
          {done ? (
            <button className="btn btn-primary" onClick={onClose}>Done</button>
          ) : (
            <>
              <button className="btn btn-secondary" onClick={onClose} disabled={running}>Cancel</button>
              <button className="btn btn-primary" onClick={sendAll} disabled={running || sendable.length === 0}>
                <Mail size={14} /> {running ? 'Sending…' : `Send ${sendable.length} email${sendable.length !== 1 ? 's' : ''}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ContractorTable({ contractors, copiedId, onCopy, onEdit, pendingCounts, onNotify, selected, canSelect, onToggle, onToggleMany, dimmed }: {
  contractors: Contractor[]
  copiedId: string | null
  onCopy: (c: Contractor) => void
  onEdit: (c: Contractor) => void
  pendingCounts: Record<string, number>
  onNotify: (c: Contractor) => void
  selected: Set<string>
  canSelect: (c: Contractor) => boolean
  onToggle: (id: string) => void
  onToggleMany: (ids: string[], on: boolean) => void
  dimmed?: boolean
}) {
  const selectable = contractors.filter(canSelect).map(c => c.id)
  const allOn = selectable.length > 0 && selectable.every(id => selected.has(id))
  const someOn = selectable.some(id => selected.has(id))
  return (
    <table className="data-table" style={{ opacity: dimmed ? 0.6 : 1 }}>
      <thead>
        <tr>
          <th style={{ width: 32 }}>
            <input
              type="checkbox"
              aria-label="Select all contractors with new items"
              title={selectable.length ? 'Select all contractors with new items' : 'No contractors with new items'}
              disabled={selectable.length === 0}
              checked={allOn}
              ref={el => { if (el) el.indeterminate = someOn && !allOn }}
              onChange={() => onToggleMany(selectable, !allOn)}
            />
          </th>
          <th>Company</th><th>Contact</th><th>Email</th><th>Phone</th><th>New items</th><th>Portal</th><th></th>
        </tr>
      </thead>
      <tbody>
        {contractors.map(c => (
          <tr key={c.id}>
            <td>
              <input
                type="checkbox"
                aria-label={`Select ${c.company_name}`}
                disabled={!canSelect(c)}
                title={!pendingCounts[c.id] ? 'No new items' : !c.email ? 'No email address on file' : undefined}
                checked={canSelect(c) && selected.has(c.id)}
                onChange={() => onToggle(c.id)}
              />
            </td>
            <td>
              <Link href={`/contractors/${c.id}`} style={{ color: '#37352f', textDecoration: 'none', fontWeight: 500 }}>
                {c.company_name}
              </Link>
            </td>
            <td style={{ color: '#787774', fontSize: 13 }}>{c.contact_name ?? '—'}</td>
            <td style={{ color: '#787774', fontSize: 13 }}>{c.email ?? '—'}</td>
            <td style={{ color: '#787774', fontSize: 13 }}>{c.phone ?? '—'}</td>
            <td>
              {pendingCounts[c.id] ? (
                <button
                  className="btn btn-ghost"
                  style={{ padding: '3px 8px', fontSize: 12, color: '#2383e2', gap: 6 }}
                  onClick={() => onNotify(c)}
                  title="Email this contractor about their new items"
                >
                  <span style={{ background: '#e7f1fb', color: '#1f6fbf', borderRadius: 10, padding: '1px 8px', fontWeight: 600, fontSize: 11 }}>
                    {pendingCounts[c.id]} new
                  </span>
                  <Mail size={13} /> Notify
                </button>
              ) : (
                <span style={{ color: '#c4c4c0', fontSize: 13 }}>—</span>
              )}
            </td>
            <td>
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  className="btn btn-ghost"
                  style={{ padding: '3px 8px', fontSize: 12 }}
                  onClick={() => onCopy(c)}
                  title="Copy portal link"
                >
                  {copiedId === c.id ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy link</>}
                </button>
                <a
                  href={`/portal/${c.portal_token}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-ghost"
                  style={{ padding: '3px 8px', fontSize: 12 }}
                >
                  <ExternalLink size={13} />
                </a>
              </div>
            </td>
            <td>
              <button
                className="btn btn-ghost"
                style={{ padding: '3px 6px', color: '#787774' }}
                onClick={() => onEdit(c)}
                title="Edit contractor"
              >
                <Pencil size={13} />
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
