'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Copy, Check, ExternalLink, Archive, ArchiveRestore, Pencil, Plus, X, Mail, Eye, EyeOff, ChevronDown, ChevronRight } from 'lucide-react'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { formatDate, formatUnitLabel, getItemRowClass } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { Contractor, ContractorContact } from '@/lib/types'
import { COUNTS_CHANGED_EVENT, NOT_PENDING_STATUSES } from '@/lib/contractor-notify'
import NotifyContractorModal, { type PendingNotifyItem } from '@/components/ui/NotifyContractorModal'

interface Props {
  contractor: Contractor
  contacts: ContractorContact[]
  assignments: any[]
  items: any[]
  /** The signed-in user's own pending items (they only notify about those). */
  pendingItems: PendingNotifyItem[]
  /** Admin only: pending items for this contractor that belong to other staff. */
  otherPendingCount?: number
  lastNotifiedAt: string | null
  /** Archiving is admin-only (the DB refuses it for staff too). */
  isAdmin?: boolean
  userId?: string
}

/** Not yet emailed to the contractor (whoever it belongs to). */
function isUnsent(item: { contractor_notified_at: string | null; portal_hidden: boolean; status: string }): boolean {
  return !item.contractor_notified_at && !item.portal_hidden && !(NOT_PENDING_STATUSES as readonly string[]).includes(item.status)
}

export default function ContractorDetailClient({ contractor: initial, contacts, assignments, items: initialItems, pendingItems: initialPending, otherPendingCount = 0, lastNotifiedAt: initialLast, isAdmin = false, userId }: Props) {
  const [contractor, setContractor] = useState(initial)
  const [pending, setPending] = useState(initialPending)
  const [lastNotifiedAt, setLastNotifiedAt] = useState(initialLast)
  const [showNotify, setShowNotify] = useState(false)
  const [flash, setFlash] = useState('')
  const [items, setItems] = useState(initialItems)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkSaving, setBulkSaving] = useState(false)
  const [bulkError, setBulkError] = useState('')
  const [showCompleted, setShowCompleted] = useState(false)
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
  const openGroups = groupByProjectUnit(openItems)
  const completedGroups = groupByProjectUnit(completedItems)
  const hiddenCount = openItems.filter(i => i.portal_hidden).length
  const selectedItems = openItems.filter(i => selected.has(i.id))
  const selectedHidden = selectedItems.filter(i => i.portal_hidden).length
  const selectedVisible = selectedItems.length - selectedHidden

  function toggleIds(ids: string[]) {
    setSelected(prev => {
      const next = new Set(prev)
      const allOn = ids.every(id => next.has(id))
      ids.forEach(id => (allOn ? next.delete(id) : next.add(id)))
      return next
    })
  }

  async function setPortalHidden(hidden: boolean) {
    const targets = selectedItems.filter(i => !!i.portal_hidden !== hidden)
    if (targets.length === 0) return
    setBulkSaving(true)
    setBulkError('')
    const ids = targets.map(i => i.id)
    const { error } = await supabase.from('maintenance_items').update({ portal_hidden: hidden }).in('id', ids)
    setBulkSaving(false)
    if (error) { setBulkError(error.message); return }

    setItems(prev => prev.map(i => (ids.includes(i.id) ? { ...i, portal_hidden: hidden } : i)))
    // Hidden items aren't announced to the contractor; showing one again puts it back on
    // the Notify list if they haven't been told about it yet.
    setPending(prev => {
      if (hidden) return prev.filter(p => !ids.includes(p.id))
      const have = new Set(prev.map(p => p.id))
      const back = targets.filter(i => !i.contractor_notified_at && !(NOT_PENDING_STATUSES as readonly string[]).includes(i.status) && !have.has(i.id) && i.responsible_id === userId)
      return [...prev, ...back]
    })
    setSelected(new Set())
    setFlash(`${hidden ? 'Hid' : 'Showed'} ${ids.length} item${ids.length !== 1 ? 's' : ''} ${hidden ? 'from' : 'in'} the portal.`)
    window.dispatchEvent(new Event(COUNTS_CHANGED_EVENT))
    router.refresh()
  }

  return (
    <div className="page-content stack-mobile" style={{ padding: '24px 32px', display: 'grid', gridTemplateColumns: '1fr 280px', gap: 28, alignItems: 'start' }}>
      <div style={{ minWidth: 0 }}>
        {/* Open items, grouped Project → Unit like the contractor portal */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: '#37352f', margin: 0 }}>
            Open Items ({openItems.length})
          </h3>
          {hiddenCount > 0 && (
            <span style={{ fontSize: 12, color: '#9b6a00', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <EyeOff size={12} /> {hiddenCount} hidden from portal
            </span>
          )}
          {openItems.length > 0 && (
            <button
              className="btn btn-ghost"
              style={{ marginLeft: 'auto', fontSize: 12, padding: '2px 8px', color: '#787774' }}
              onClick={() => (openItems.every(i => selected.has(i.id)) ? setSelected(new Set()) : setSelected(new Set(openItems.map(i => i.id))))}
            >
              {openItems.every(i => selected.has(i.id)) ? 'Clear selection' : 'Select all'}
            </button>
          )}
        </div>

        {selected.size > 0 && (
          <div style={{ position: 'sticky', top: 8, zIndex: 5, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', background: '#37352f', color: 'white', borderRadius: 8, padding: '8px 12px', marginBottom: 14, fontSize: 13 }}>
            <strong>{selected.size} selected</strong>
            <span style={{ color: '#bdbcb8', fontSize: 12 }}>
              {selectedVisible} visible · {selectedHidden} hidden
            </span>
            <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', flexWrap: 'wrap' }}>
              <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }} disabled={bulkSaving || selectedVisible === 0} onClick={() => setPortalHidden(true)}>
                <EyeOff size={13} /> Hide from portal
              </button>
              <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }} disabled={bulkSaving || selectedHidden === 0} onClick={() => setPortalHidden(false)}>
                <Eye size={13} /> Show in portal
              </button>
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 8px', color: '#bdbcb8' }} onClick={() => setSelected(new Set())} title="Clear selection">
                <X size={14} />
              </button>
            </div>
          </div>
        )}
        {bulkError && <p style={{ fontSize: 13, color: '#c4554d', margin: '0 0 12px' }}>{bulkError}</p>}

        {openItems.length === 0 ? (
          <p style={{ color: '#787774', fontSize: 14, marginBottom: 28 }}>No open items.</p>
        ) : (
          <div style={{ marginBottom: 32 }}>
            {openGroups.map(({ project, units }) => {
              const projectIds = units.flatMap(u => u.items.map(i => i.id))
              const projectHidden = units.reduce((s, u) => s + u.items.filter(i => i.portal_hidden).length, 0)
              return (
                <div key={project.id} style={{ marginBottom: 24 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 6, marginBottom: 8, borderBottom: '2px solid #37352f' }}>
                    <SelectBox ids={projectIds} selected={selected} onToggle={toggleIds} label={`Select all items in ${project.name}`} />
                    <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#37352f' }}>
                      {project.id !== 'none'
                        ? <Link href={`/projects/${project.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>{project.name}</Link>
                        : project.name}
                    </h2>
                    <span style={{ fontSize: 12, color: '#787774' }}>
                      {projectIds.length} item{projectIds.length !== 1 ? 's' : ''}
                      {projectHidden > 0 && <> · <span style={{ color: '#9b6a00' }}>{projectHidden === projectIds.length ? 'all hidden' : `${projectHidden} hidden`}</span></>}
                    </span>
                  </div>

                  {units.map(({ unit, items: unitItems }) => {
                    const unitIds = unitItems.map(i => i.id)
                    return (
                      <div key={unit.id} style={{ border: '1px solid #e9e9e7', borderRadius: 8, marginBottom: 8, overflow: 'hidden' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: '#f7f7f5', borderBottom: '1px solid #e9e9e7' }}>
                          <SelectBox ids={unitIds} selected={selected} onToggle={toggleIds} label={`Select all items in ${formatUnitLabel(unit)}`} />
                          <span style={{ fontSize: 13, fontWeight: 600, color: '#37352f' }}>{formatUnitLabel(unit)}</span>
                          <span style={{ fontSize: 12, color: '#787774' }}>{unitItems.length}</span>
                        </div>
                        <table className="data-table" style={{ margin: 0 }}>
                          <tbody>
                            {unitItems.map((item: any) => (
                              <tr key={item.id} className={getItemRowClass(item)} style={item.portal_hidden ? { opacity: 0.6 } : undefined}>
                                <td style={{ width: 32 }}>
                                  <SelectBox ids={[item.id]} selected={selected} onToggle={toggleIds} label={`Select ${item.item_number}`} />
                                </td>
                                <td style={{ color: '#787774', fontSize: 13, width: 90, whiteSpace: 'nowrap' }}>{item.item_number}</td>
                                <td className="wrap-mobile">
                                  <Link href={`/maintenance/${item.id}`} style={{ color: '#37352f', fontWeight: 500, textDecoration: 'none' }}>{item.title}</Link>
                                  {item.portal_hidden && (
                                    <span title="Hidden from the contractor portal" style={{ marginLeft: 8, background: '#fbf3db', color: '#9b6a00', borderRadius: 10, padding: '1px 7px', fontWeight: 600, fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 3, verticalAlign: 'middle' }}>
                                      <EyeOff size={10} /> Hidden
                                    </span>
                                  )}
                                  {isUnsent(item) && (
                                    <span title="Not yet emailed to this contractor" style={{ marginLeft: 8, background: '#e7f1fb', color: '#1f6fbf', borderRadius: 10, padding: '1px 7px', fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap' }}>Not emailed</span>
                                  )}
                                </td>
                                <td style={{ width: 130 }}><StatusBadge status={item.status} /></td>
                                <td style={{ fontSize: 13, color: '#787774', width: 100, whiteSpace: 'nowrap' }}>{formatDate(item.created_at)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )}

        {completedItems.length > 0 && (
          <>
            <button
              onClick={() => setShowCompleted(s => !s)}
              style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 600, color: '#787774', marginBottom: 12 }}
            >
              {showCompleted ? <ChevronDown size={15} /> : <ChevronRight size={15} />} Completed ({completedItems.length})
            </button>
            {showCompleted && completedGroups.map(({ project, units }) => (
              <div key={project.id} style={{ marginBottom: 20 }}>
                <h2 style={{ margin: '0 0 8px', paddingBottom: 6, borderBottom: '1px solid #e9e9e7', fontSize: 14, fontWeight: 700, color: '#787774' }}>{project.name}</h2>
                {units.map(({ unit, items: unitItems }) => (
                  <div key={unit.id} style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#37352f', margin: '0 0 4px 4px' }}>{formatUnitLabel(unit)}</div>
                    <table className="data-table" style={{ margin: 0 }}>
                      <tbody>
                        {unitItems.map((item: any) => (
                          <tr key={item.id}>
                            <td style={{ color: '#787774', fontSize: 13, width: 90, whiteSpace: 'nowrap' }}>{item.item_number}</td>
                            <td className="wrap-mobile"><Link href={`/maintenance/${item.id}`} style={{ color: '#37352f', fontWeight: 500, textDecoration: 'none' }}>{item.title}</Link></td>
                            <td style={{ fontSize: 13, color: '#787774', width: 100, whiteSpace: 'nowrap' }}>{formatDate(item.completed_at ?? item.created_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            ))}
          </>
        )}
      </div>

      {/* Sidebar */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* New-items notification */}
        <div style={{ border: `1px solid ${pending.length ? '#b9d7f5' : '#e9e9e7'}`, background: pending.length ? '#f4f9fe' : 'white', borderRadius: 8, padding: '14px 16px' }}>
          <h4 style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 600, color: '#787774', textTransform: 'uppercase', letterSpacing: '0.05em' }}>New Items</h4>
          <p style={{ fontSize: 13, color: '#37352f', margin: '0 0 10px' }}>
            {pending.length
              ? <><strong>{pending.length}</strong> of your item{pending.length !== 1 ? 's' : ''} assigned since their last email.</>
              : 'Up to date with your items.'}
          </p>
          {otherPendingCount > 0 && (
            <p style={{ fontSize: 12, color: '#787774', margin: '0 0 10px' }}>
              {otherPendingCount} more belong{otherPendingCount === 1 ? 's' : ''} to other staff.
            </p>
          )}
          {(pending.length > 0 || otherPendingCount > 0) && (
            <button
              className={`btn ${pending.length ? 'btn-primary' : 'btn-secondary'}`}
              style={{ width: '100%', justifyContent: 'center', fontSize: 13 }}
              onClick={() => setShowNotify(true)}
            >
              <Mail size={14} /> {pending.length ? `Notify (${pending.length} new)` : 'Notify on behalf of others'}
            </button>
          )}
          {hiddenCount > 0 && (
            <p style={{ fontSize: 12, color: '#9b6a00', margin: '8px 0 0' }}>
              {hiddenCount} hidden item{hiddenCount !== 1 ? 's' : ''} won&apos;t be emailed until shown in the portal.
            </p>
          )}
          {flash && <p style={{ fontSize: 12, color: '#0f7b6c', margin: '8px 0 0' }}>{flash}</p>}
          <p style={{ fontSize: 12, color: '#9b9a97', margin: '8px 0 0' }}>
            Last notified: {lastNotifiedAt ? formatDate(lastNotifiedAt) : 'never'}
          </p>
        </div>

        {/* Contact card — view or edit mode */}
        <div style={{ border: '1px solid #e9e9e7', borderRadius: 8, padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
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

        <OtherContacts contractorId={contractor.id} initial={contacts} />

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
          <p style={{ fontSize: 13, color: '#787774', margin: isAdmin ? '0 0 10px' : 0 }}>
            {contractor.is_active ? 'Active — visible across the app.' : 'Archived — hidden from new items.'}
          </p>
          {/* Contractors are shared by all staff, so only an admin archives/restores them. */}
          {isAdmin && (
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
          )}
        </div>
      </div>

      {showNotify && (
        <NotifyContractorModal
          contractor={contractor}
          items={pending}
          onClose={() => setShowNotify(false)}
          onDone={(ids, mode) => {
            const now = new Date().toISOString()
            setPending(prev => prev.filter(p => !ids.includes(p.id)))
            setItems(prev => prev.map(i => (ids.includes(i.id) ? { ...i, contractor_notified_at: now } : i)))
            setLastNotifiedAt(now)
            setShowNotify(false)
            setFlash(mode === 'email' ? `Emailed ${contractor.email} about ${ids.length} item${ids.length !== 1 ? 's' : ''}.` : `Marked ${ids.length} item${ids.length !== 1 ? 's' : ''} as told.`)
            router.refresh()
          }}
        />
      )}
    </div>
  )
}

const emptyContact = { name: '', role: '', email: '', phone: '' }

/** Additional people at the contractor: add, edit inline, remove. */
function OtherContacts({ contractorId, initial }: { contractorId: string; initial: ContractorContact[] }) {
  const supabase = createClient()
  const [contacts, setContacts] = useState(initial)
  // null = no form open; 'new' = adding; otherwise the id being edited
  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm] = useState(emptyContact)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function open(c?: ContractorContact) {
    setEditing(c ? c.id : 'new')
    setForm(c ? { name: c.name, role: c.role ?? '', email: c.email ?? '', phone: c.phone ?? '' } : emptyContact)
    setError('')
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    setError('')
    const payload = { name: form.name.trim(), role: form.role.trim() || null, email: form.email.trim() || null, phone: form.phone.trim() || null }
    const { data, error } = editing === 'new'
      ? await supabase.from('contractor_contacts').insert({ contractor_id: contractorId, ...payload }).select().single()
      : await supabase.from('contractor_contacts').update(payload).eq('id', editing!).select().single()
    setSaving(false)
    if (error || !data) { setError(error?.message ?? 'Could not save contact.'); return }
    setContacts(prev => editing === 'new' ? [...prev, data] : prev.map(c => c.id === data.id ? data : c))
    setEditing(null)
  }

  async function remove(c: ContractorContact) {
    if (!confirm(`Remove ${c.name} from this contractor's contacts?`)) return
    const { error } = await supabase.from('contractor_contacts').delete().eq('id', c.id)
    if (error) { setError(error.message); return }
    setContacts(prev => prev.filter(x => x.id !== c.id))
    if (editing === c.id) setEditing(null)
  }

  const formEl = (
    <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 8, background: '#f7f7f5', borderRadius: 6, padding: 10, marginBottom: 8 }}>
      <Field label="Name *"><input className="input" autoFocus required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></Field>
      <Field label="Role"><input className="input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} placeholder="e.g. Office, Site supervisor, Accounts" /></Field>
      <Field label="Email"><input className="input" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></Field>
      <Field label="Phone"><input className="input" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} /></Field>
      {error && <p style={{ fontSize: 12, color: '#c4554d', margin: 0 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="submit" className="btn btn-primary" style={{ flex: 1, justifyContent: 'center', fontSize: 13 }} disabled={saving || !form.name.trim()}>
          {saving ? 'Saving…' : editing === 'new' ? 'Add' : 'Save'}
        </button>
        <button type="button" className="btn btn-secondary" style={{ padding: '6px 10px' }} onClick={() => setEditing(null)}><X size={14} /></button>
      </div>
    </form>
  )

  return (
    <div style={{ border: '1px solid #e9e9e7', borderRadius: 8, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 8 }}>
        <h4 style={{ margin: 0, fontSize: 12, fontWeight: 600, color: '#787774', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Other Contacts</h4>
        {editing === null && (
          <button className="btn btn-ghost" style={{ padding: '2px 6px', color: '#787774' }} onClick={() => open()} title="Add a contact">
            <Plus size={14} />
          </button>
        )}
      </div>

      {contacts.map(c => editing === c.id ? <div key={c.id}>{formEl}</div> : (
        <div key={c.id} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', padding: '6px 0', borderTop: '1px solid #f1f1ef', fontSize: 13 }}>
          <div style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
            <div style={{ fontWeight: 500, color: '#37352f' }}>
              {c.name}{c.role && <span style={{ fontWeight: 400, color: '#787774' }}> · {c.role}</span>}
            </div>
            {c.email && <div style={{ color: '#787774' }}>{c.email}</div>}
            {c.phone && <div style={{ color: '#787774' }}>{c.phone}</div>}
          </div>
          {editing === null && (
            <div style={{ display: 'flex', flexShrink: 0 }}>
              <button className="btn btn-ghost" style={{ padding: '2px 4px', color: '#787774' }} onClick={() => open(c)} title="Edit contact"><Pencil size={12} /></button>
              <button className="btn btn-ghost" style={{ padding: '2px 4px', color: '#787774' }} onClick={() => remove(c)} title="Remove contact"><X size={13} /></button>
            </div>
          )}
        </div>
      ))}

      {editing === 'new' && formEl}
      {contacts.length === 0 && editing === null && (
        <p style={{ fontSize: 13, color: '#787774', margin: 0 }}>No other contacts. Click + to add.</p>
      )}
      {error && editing === null && <p style={{ fontSize: 12, color: '#c4554d', margin: '6px 0 0' }}>{error}</p>}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, fontSize: 13, marginBottom: 4 }}>
      <span style={{ color: '#787774', minWidth: 48, flexShrink: 0 }}>{label}</span>
      <span style={{ color: '#37352f', minWidth: 0, overflowWrap: 'anywhere' }}>{value}</span>
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

type GroupUnit = { id: string; unit_identifier: string | null; address: string | null }
type Group = { project: { id: string; name: string }; units: { unit: GroupUnit; items: any[] }[] }

/** Project → Unit → items: projects A–Z, units and item numbers in natural order (2 before 10). */
function groupByProjectUnit(list: any[]): Group[] {
  const projects = new Map<string, { project: { id: string; name: string }; units: Map<string, { unit: GroupUnit; items: any[] }> }>()
  for (const item of list) {
    const project = item.unit?.project ?? { id: 'none', name: 'No project' }
    const unit = item.unit ?? { id: 'none', unit_identifier: null, address: null }
    if (!projects.has(project.id)) projects.set(project.id, { project, units: new Map() })
    const p = projects.get(project.id)!
    if (!p.units.has(unit.id)) p.units.set(unit.id, { unit, items: [] })
    p.units.get(unit.id)!.items.push(item)
  }
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  return Array.from(projects.values())
    .sort((a, b) => collator.compare(a.project.name, b.project.name))
    .map(p => ({
      project: p.project,
      units: Array.from(p.units.values())
        .sort((a, b) => collator.compare(formatUnitLabel(a.unit), formatUnitLabel(b.unit)))
        .map(u => ({ ...u, items: [...u.items].sort((a, b) => collator.compare(a.item_number, b.item_number)) })),
    }))
}

/** Checkbox for one item or a whole group: ticked when all are selected, dashed when only some are. */
function SelectBox({ ids, selected, onToggle, label }: { ids: string[]; selected: Set<string>; onToggle: (ids: string[]) => void; label: string }) {
  const count = ids.filter(id => selected.has(id)).length
  return (
    <input
      type="checkbox"
      aria-label={label}
      title={label}
      checked={ids.length > 0 && count === ids.length}
      ref={el => { if (el) el.indeterminate = count > 0 && count < ids.length }}
      onChange={() => onToggle(ids)}
      style={{ width: 15, height: 15, cursor: 'pointer', flexShrink: 0, margin: 0 }}
    />
  )
}
