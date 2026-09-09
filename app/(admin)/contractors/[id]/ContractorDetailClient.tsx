'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Copy, Check, ExternalLink, Archive, ArchiveRestore, Pencil, X } from 'lucide-react'
import { StatusBadge, PriorityBadge } from '@/components/ui/StatusBadge'
import { formatDate } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { Contractor } from '@/lib/types'

interface Props {
  contractor: Contractor
  assignments: any[]
  items: any[]
}

export default function ContractorDetailClient({ contractor: initial, assignments, items }: Props) {
  const [contractor, setContractor] = useState(initial)
  const [copied, setCopied] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editForm, setEditForm] = useState({
    company_name: initial.company_name,
    contact_name: initial.contact_name ?? '',
    email: initial.email ?? '',
    phone: initial.phone ?? '',
    notes: initial.notes ?? '',
  })
  const supabase = createClient()
  const router = useRouter()
  const portalUrl = typeof window !== 'undefined' ? `${window.location.origin}/portal/${contractor.portal_token}` : `/portal/${contractor.portal_token}`

  function copyLink() {
    navigator.clipboard.writeText(portalUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function toggleArchive() {
    setArchiving(true)
    const newActive = !contractor.is_active
    const { data } = await supabase
      .from('contractors')
      .update({ is_active: newActive })
      .eq('id', contractor.id)
      .select()
      .single()
    if (data) setContractor(data)
    setArchiving(false)
    router.refresh()
  }

  function openEdit() {
    setEditForm({
      company_name: contractor.company_name,
      contact_name: contractor.contact_name ?? '',
      email: contractor.email ?? '',
      phone: contractor.phone ?? '',
      notes: contractor.notes ?? '',
    })
    setEditMode(true)
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const { data } = await supabase
      .from('contractors')
      .update({
        company_name: editForm.company_name,
        contact_name: editForm.contact_name || null,
        email: editForm.email || null,
        phone: editForm.phone || null,
        notes: editForm.notes || null,
      })
      .eq('id', contractor.id)
      .select()
      .single()
    if (data) {
      setContractor(data)
      setEditMode(false)
      router.refresh()
    }
    setSaving(false)
  }

  const openItems = items.filter(i => i.status !== 'complete')
  const completedItems = items.filter(i => i.status === 'complete')

  return (
    <div style={{ padding: '24px 32px', display: 'grid', gridTemplateColumns: '1fr 280px', gap: 28, alignItems: 'start' }}>
      <div>
        {/* Open items */}
        <h3 style={{ fontSize: 14, fontWeight: 600, color: '#37352f', marginBottom: 12 }}>
          Open Items ({openItems.length})
        </h3>
        {openItems.length === 0 ? (
          <p style={{ color: '#787774', fontSize: 14 }}>No open items.</p>
        ) : (
          <table className="data-table" style={{ marginBottom: 28 }}>
            <thead><tr><th>#</th><th>Title</th><th>Project</th><th>Construction No.</th><th>Status</th><th>Priority</th><th>Age</th></tr></thead>
            <tbody>
              {openItems.map((item: any) => (
                <tr key={item.id}>
                  <td style={{ color: '#787774', fontSize: 13 }}>{item.item_number}</td>
                  <td><Link href={`/maintenance/${item.id}`} style={{ color: '#37352f', fontWeight: 500, textDecoration: 'none' }}>{item.title}</Link></td>
                  <td style={{ fontSize: 13, color: '#787774' }}>{item.unit?.project?.name ?? '—'}</td>
                  <td style={{ fontSize: 13 }}>{item.unit?.unit_identifier ?? '—'}</td>
                  <td><StatusBadge status={item.status} /></td>
                  <td><PriorityBadge priority={item.priority} /></td>
                  <td style={{ fontSize: 13, color: '#787774' }}>{formatDate(item.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {completedItems.length > 0 && (
          <>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: '#787774', marginBottom: 12 }}>Completed ({completedItems.length})</h3>
            <table className="data-table">
              <thead><tr><th>#</th><th>Title</th><th>Project</th><th>Construction No.</th><th>Completed</th></tr></thead>
              <tbody>
                {completedItems.slice(0, 20).map((item: any) => (
                  <tr key={item.id}>
                    <td style={{ color: '#787774', fontSize: 13 }}>{item.item_number}</td>
                    <td><Link href={`/maintenance/${item.id}`} style={{ color: '#37352f', fontWeight: 500, textDecoration: 'none' }}>{item.title}</Link></td>
                    <td style={{ fontSize: 13, color: '#787774' }}>{item.unit?.project?.name ?? '—'}</td>
                    <td style={{ fontSize: 13 }}>{item.unit?.unit_identifier ?? '—'}</td>
                    <td style={{ fontSize: 13, color: '#787774' }}>{formatDate(item.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      {/* Sidebar */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Contact card — view or edit mode */}
        <div style={{ border: '1px solid #e9e9e7', borderRadius: 8, padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <h4 style={{ margin: 0, fontSize: 12, fontWeight: 600, color: '#787774', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Contact</h4>
            {!editMode && (
              <button className="btn btn-ghost" style={{ padding: '2px 6px', color: '#787774' }} onClick={openEdit} title="Edit contractor details">
                <Pencil size={13} />
              </button>
            )}
          </div>

          {editMode ? (
            <form onSubmit={handleSaveEdit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Field label="Company name *">
                <input className="input" required value={editForm.company_name} onChange={e => setEditForm(f => ({ ...f, company_name: e.target.value }))} />
              </Field>
              <Field label="Contact name">
                <input className="input" value={editForm.contact_name} onChange={e => setEditForm(f => ({ ...f, contact_name: e.target.value }))} />
              </Field>
              <Field label="Email">
                <input className="input" type="email" value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} />
              </Field>
              <Field label="Phone">
                <input className="input" value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} />
              </Field>
              <Field label="Notes">
                <textarea className="input" value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} placeholder="Reliability notes, rates, etc." style={{ minHeight: 64 }} />
              </Field>
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                <button type="submit" className="btn btn-primary" style={{ flex: 1, justifyContent: 'center', fontSize: 13 }} disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button type="button" className="btn btn-secondary" style={{ padding: '6px 10px' }} onClick={() => setEditMode(false)}>
                  <X size={14} />
                </button>
              </div>
            </form>
          ) : (
            <>
              {contractor.contact_name && <Row label="Name" value={contractor.contact_name} />}
              {contractor.email && <Row label="Email" value={contractor.email} />}
              {contractor.phone && <Row label="Phone" value={contractor.phone} />}
              {contractor.notes && <><div style={{ borderTop: '1px solid #f1f1ef', margin: '8px 0' }} /><p style={{ fontSize: 13, color: '#37352f' }}>{contractor.notes}</p></>}
              {!contractor.contact_name && !contractor.email && !contractor.phone && !contractor.notes && (
                <p style={{ fontSize: 13, color: '#787774', margin: 0 }}>No contact details. Click edit to add.</p>
              )}
            </>
          )}
        </div>

        <div style={{ border: '1px solid #e9e9e7', borderRadius: 8, padding: '14px 16px' }}>
          <h4 style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 600, color: '#787774', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Contractor Portal</h4>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-secondary" style={{ flex: 1, justifyContent: 'center', fontSize: 13 }} onClick={copyLink}>
              {copied ? <><Check size={13} /> Copied!</> : <><Copy size={13} /> Copy Link</>}
            </button>
            <a href={`/portal/${contractor.portal_token}`} target="_blank" rel="noopener noreferrer" className="btn btn-secondary" style={{ padding: '6px 10px' }}>
              <ExternalLink size={14} />
            </a>
          </div>
        </div>

        {assignments.length > 0 && (
          <div style={{ border: '1px solid #e9e9e7', borderRadius: 8, padding: '14px 16px' }}>
            <h4 style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 600, color: '#787774', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Project Assignments</h4>
            {assignments.map((a: any) => (
              <div key={a.id} style={{ fontSize: 13, marginBottom: 6 }}>
                <Link href={`/projects/${a.project?.id}`} style={{ color: '#2383e2', textDecoration: 'none' }}>{a.project?.name}</Link>
                <span style={{ color: '#787774' }}> · {a.trade?.name}</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ border: `1px solid ${contractor.is_active ? '#e9e9e7' : '#f0d4d4'}`, borderRadius: 8, padding: '14px 16px', background: contractor.is_active ? 'white' : '#fff8f8' }}>
          <h4 style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 600, color: '#787774', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status</h4>
          <p style={{ fontSize: 13, color: '#787774', margin: '0 0 10px' }}>
            {contractor.is_active ? 'Active — visible across the app.' : 'Archived — hidden from new items.'}
          </p>
          <button
            className={`btn ${contractor.is_active ? 'btn-secondary' : 'btn-primary'}`}
            style={{ width: '100%', justifyContent: 'center', fontSize: 13 }}
            onClick={toggleArchive}
            disabled={archiving}
          >
            {contractor.is_active
              ? <><Archive size={14} /> {archiving ? 'Archiving…' : 'Archive Contractor'}</>
              : <><ArchiveRestore size={14} /> {archiving ? 'Restoring…' : 'Restore Contractor'}</>}
          </button>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, fontSize: 13, marginBottom: 4 }}>
      <span style={{ color: '#787774', minWidth: 48, flexShrink: 0 }}>{label}</span>
      <span style={{ color: '#37352f' }}>{value}</span>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 3, color: '#787774' }}>{label}</label>
      {children}
    </div>
  )
}
