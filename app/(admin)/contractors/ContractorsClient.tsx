'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Plus, Copy, Check, ExternalLink, Pencil } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { Contractor } from '@/lib/types'

interface Props { contractors: Contractor[] }

const emptyForm = { company_name: '', contact_name: '', email: '', phone: '', notes: '' }

export default function ContractorsClient({ contractors: initial }: Props) {
  const [contractors, setContractors] = useState(initial)
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
    <div style={{ padding: '24px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 20 }}>
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
                    dimmed
                  />
                </div>
              )}
            </div>
          )}
        </>
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

function ContractorTable({ contractors, copiedId, onCopy, onEdit, dimmed }: {
  contractors: Contractor[]
  copiedId: string | null
  onCopy: (c: Contractor) => void
  onEdit: (c: Contractor) => void
  dimmed?: boolean
}) {
  return (
    <table className="data-table" style={{ opacity: dimmed ? 0.6 : 1 }}>
      <thead>
        <tr><th>Company</th><th>Contact</th><th>Email</th><th>Phone</th><th>Portal</th><th></th></tr>
      </thead>
      <tbody>
        {contractors.map(c => (
          <tr key={c.id}>
            <td>
              <Link href={`/contractors/${c.id}`} style={{ color: '#37352f', textDecoration: 'none', fontWeight: 500 }}>
                {c.company_name}
              </Link>
            </td>
            <td style={{ color: '#787774', fontSize: 13 }}>{c.contact_name ?? '—'}</td>
            <td style={{ color: '#787774', fontSize: 13 }}>{c.email ?? '—'}</td>
            <td style={{ color: '#787774', fontSize: 13 }}>{c.phone ?? '—'}</td>
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
