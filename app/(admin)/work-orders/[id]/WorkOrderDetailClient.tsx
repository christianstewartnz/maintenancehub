'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { WorkOrderStatusBadge, StatusBadge } from '@/components/ui/StatusBadge'
import { formatDate, formatUnitLabel } from '@/lib/utils'
import { Download, Send, Pencil, Check, X, Mail, Archive, ArchiveRestore, Lock } from 'lucide-react'

interface Props {
  workOrder: any
  items: any[]
  /** Items that could be added while it's a draft (same contractor, project and unit). */
  available: any[]
}

/**
 * A work order is editable (notes, items) while it's a draft. Sending it — by email or
 * by downloading the Outlook draft — locks it. Any work order can be archived.
 */
export default function WorkOrderDetailClient({ workOrder, items, available }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState<'' | 'send' | 'outlook' | 'archive' | 'notes' | 'items'>('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesValue, setNotesValue] = useState(workOrder.notes ?? '')
  const [editingItems, setEditingItems] = useState(false)
  const [checked, setChecked] = useState<Set<string>>(new Set())

  const project = workOrder.project
  const contractor = workOrder.contractor
  const archived = !!workOrder.archived_at
  const editable = workOrder.status === 'draft' && !archived
  const canSend = editable && items.length > 0

  function reset() { setError(''); setSuccess('') }

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    const res = await fetch(`/api/work-orders/${workOrder.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { setError(json.error ?? 'Something went wrong.'); return false }
    return true
  }

  async function handleSend() {
    reset()
    setBusy('send')
    const res = await fetch(`/api/work-orders/${workOrder.id}/send`, { method: 'POST' })
    const json = await res.json().catch(() => ({}))
    setBusy('')
    if (!res.ok) {
      setError(`${json.error ?? 'Failed to send work order.'} You can use “Download Outlook email” instead.`)
      return
    }
    setSuccess(`Work order sent to ${(json.to ?? [contractor?.email]).join(', ')}`)
    router.refresh()
  }

  async function handleOutlook() {
    reset()
    if (workOrder.status === 'draft' && !confirm('Download this work order as an Outlook email (PDF attached)?\n\nIt will be marked as sent and can no longer be edited. Open the downloaded file and press Send in Outlook.')) return
    setBusy('outlook')
    const res = await fetch(`/api/work-orders/${workOrder.id}/outlook`, { method: 'POST' })
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      setError(json.error ?? 'Failed to create the Outlook email.')
      setBusy('')
      return
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${workOrder.work_order_number} - ${(contractor?.company_name ?? 'Work order').trim()}.eml`.replace(/[\\/:*?"<>|]+/g, '-')
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
    setBusy('')
    setSuccess('Outlook email downloaded. Open it and press Send.')
    router.refresh()
  }

  async function handleArchive(archive: boolean) {
    reset()
    if (archive) {
      const msg = workOrder.status === 'draft'
        ? `Archive ${workOrder.work_order_number}?\n\nIt hasn't been sent, so its items will be taken off it and can go on another work order.`
        : `Archive ${workOrder.work_order_number}?\n\nIt will be hidden from the work orders list. Its items stay linked to it as a record.`
      if (!confirm(msg)) return
    }
    setBusy('archive')
    const ok = await patch({ archived: archive })
    setBusy('')
    if (ok) {
      setSuccess(archive ? 'Work order archived.' : 'Work order restored.')
      router.refresh()
    }
  }

  async function handleSaveNotes() {
    reset()
    setBusy('notes')
    const ok = await patch({ notes: notesValue })
    setBusy('')
    if (ok) { setEditingNotes(false); router.refresh() }
  }

  function startEditItems() {
    reset()
    setChecked(new Set(items.map(i => i.id)))
    setEditingItems(true)
  }

  async function handleSaveItems() {
    reset()
    const current = new Set(items.map(i => i.id))
    const add = [...checked].filter(id => !current.has(id))
    const remove = [...current].filter(id => !checked.has(id))
    if (!add.length && !remove.length) { setEditingItems(false); return }
    setBusy('items')
    const ok = await patch({ add_item_ids: add, remove_item_ids: remove })
    setBusy('')
    if (ok) { setEditingItems(false); router.refresh() }
  }

  // Edit list: current items first, then ones that could be added.
  const editRows = useMemo(() => [...items, ...available], [items, available])
  // One unit per work order: once something is ticked, other units' items are disabled.
  const lockedUnit = useMemo(() => editRows.find(r => checked.has(r.id))?.unit_id ?? null, [editRows, checked])

  function toggle(id: string) {
    setChecked(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <div className="page-content" style={{ padding: '24px 32px' }}>
      {archived && (
        <div style={{ background: '#fff8e6', border: '1px solid #f5d38a', borderRadius: 8, padding: '10px 14px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Archive size={15} style={{ color: '#c97d0a' }} />
          <span style={{ fontSize: 14, color: '#37352f' }}>This work order was archived {formatDate(workOrder.archived_at)}.</span>
          <div style={{ flex: 1 }} />
          <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 13 }} onClick={() => handleArchive(false)} disabled={!!busy}>
            <ArchiveRestore size={13} /> {busy === 'archive' ? 'Restoring…' : 'Restore'}
          </button>
        </div>
      )}

      {/* Info cards */}
      <div className="info-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 28 }}>
        <InfoCard title="Project">
          <Link href={`/projects/${project?.id}`} style={{ color: '#2383e2', textDecoration: 'none', fontWeight: 500 }}>
            {project?.name}
          </Link>
          {project?.development_company && <p style={{ margin: '4px 0 0', fontSize: 13, color: '#37352f' }}>{project.development_company}</p>}
          {project?.address && <p style={{ margin: '2px 0 0', fontSize: 13, color: '#787774' }}>{project.address}</p>}
        </InfoCard>

        <InfoCard title="Contractor">
          <Link href={`/contractors/${contractor?.id}`} style={{ color: '#2383e2', textDecoration: 'none', fontWeight: 500 }}>
            {contractor?.company_name}
          </Link>
          {contractor?.contact_name && <p style={{ margin: '4px 0 0', fontSize: 13, color: '#787774' }}>{contractor.contact_name}</p>}
          {contractor?.email && <p style={{ margin: '2px 0 0', fontSize: 13, color: '#787774' }}>{contractor.email}</p>}
          {contractor?.phone && <p style={{ margin: '2px 0 0', fontSize: 13, color: '#787774' }}>{contractor.phone}</p>}
        </InfoCard>

        <InfoCard title="Status">
          <WorkOrderStatusBadge status={workOrder.status} />
          <p style={{ margin: '8px 0 2px', fontSize: 13, color: '#787774' }}>Created {formatDate(workOrder.created_at)}</p>
          {workOrder.sent_at && (
            <p style={{ margin: '2px 0 0', fontSize: 13, color: '#787774', display: 'flex', alignItems: 'center', gap: 4 }}>
              Sent {formatDate(workOrder.sent_at)} · <Lock size={11} /> locked
            </p>
          )}
        </InfoCard>
      </div>

      {/* Notes — editable while a draft */}
      <div style={{ background: '#f7f7f5', border: '1px solid #e9e9e7', borderRadius: 8, padding: '12px 16px', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: editingNotes ? 8 : workOrder.notes ? 6 : 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#787774', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Notes</div>
          {editable && !editingNotes && (
            <button
              className="btn btn-ghost"
              style={{ padding: '2px 6px', fontSize: 12, color: '#787774', display: 'flex', alignItems: 'center', gap: 4 }}
              onClick={() => { setNotesValue(workOrder.notes ?? ''); setEditingNotes(true) }}
            >
              <Pencil size={12} /> {workOrder.notes ? 'Edit' : 'Add notes'}
            </button>
          )}
        </div>

        {editingNotes ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <textarea
              className="input"
              value={notesValue}
              onChange={e => setNotesValue(e.target.value)}
              placeholder="Add notes about this work order…"
              style={{ minHeight: 80, background: 'white' }}
              autoFocus
            />
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" style={{ padding: '5px 10px', fontSize: 13 }} onClick={() => setEditingNotes(false)}>
                <X size={13} /> Cancel
              </button>
              <button className="btn btn-primary" style={{ padding: '5px 12px', fontSize: 13 }} onClick={handleSaveNotes} disabled={busy === 'notes'}>
                <Check size={13} /> {busy === 'notes' ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        ) : (
          workOrder.notes
            ? <p style={{ margin: 0, fontSize: 14, whiteSpace: 'pre-wrap', color: '#37352f' }}>{workOrder.notes}</p>
            : <p style={{ margin: 0, fontSize: 13, color: '#b0aea8', fontStyle: 'italic' }}>No notes added.</p>
        )}
      </div>

      {/* Action bar */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, color: '#37352f', fontWeight: 500 }}>
          {items.length} item{items.length !== 1 ? 's' : ''}
        </span>
        {editable && !editingItems && (
          <button className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: 13, color: '#787774' }} onClick={startEditItems}>
            <Pencil size={12} /> Edit items
          </button>
        )}
        <div style={{ flex: 1 }} />
        {!archived && (
          <button className="btn btn-ghost" style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#787774' }} onClick={() => handleArchive(true)} disabled={!!busy}>
            <Archive size={15} /> {busy === 'archive' ? 'Archiving…' : 'Archive'}
          </button>
        )}
        <a href={`/api/work-orders/${workOrder.id}/pdf`} target="_blank" rel="noreferrer">
          <button className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Download size={15} /> Download PDF
          </button>
        </a>
        {!archived && (canSend || workOrder.status !== 'draft') && (
          <button
            className="btn btn-secondary"
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            onClick={handleOutlook}
            disabled={!!busy || editingItems || editingNotes}
            title="Download the work order email (PDF attached) to send from your own Outlook. Marks it as sent."
          >
            <Mail size={15} /> {busy === 'outlook' ? 'Generating…' : 'Download Outlook email'}
          </button>
        )}
        {canSend && (
          <button
            className="btn btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            onClick={handleSend}
            disabled={!!busy || editingItems || editingNotes}
          >
            <Send size={15} />
            {busy === 'send' ? 'Sending…' : `Send to ${contractor?.company_name}`}
          </button>
        )}
      </div>
      {(error || success) && (
        <p style={{ margin: '0 0 16px', fontSize: 13, color: error ? '#e03131' : '#2f9e44', textAlign: 'right' }}>{error || success}</p>
      )}

      {/* Items */}
      {editingItems ? (
        <div style={{ border: '1px solid #e9e9e7', borderRadius: 8, overflow: 'hidden', marginTop: 8 }}>
          {editRows.length === 0 ? (
            <p style={{ padding: 16, margin: 0, fontSize: 14, color: '#787774' }}>This contractor has no open items in this project that aren&apos;t on a work order.</p>
          ) : (
            <table className="data-table" style={{ marginBottom: 0 }}>
              <thead>
                <tr><th style={{ width: 40 }}></th><th>#</th><th>Title</th><th>Unit</th><th>Status</th></tr>
              </thead>
              <tbody>
                {editRows.map(item => {
                  const on = checked.has(item.id)
                  const disabled = !on && lockedUnit !== null && item.unit_id !== lockedUnit
                  return (
                    <tr
                      key={item.id}
                      style={{ cursor: disabled ? 'not-allowed' : 'pointer', background: on ? '#f0f7ff' : undefined, opacity: disabled ? 0.45 : 1 }}
                      onClick={() => !disabled && toggle(item.id)}
                      title={disabled ? 'A work order covers one unit' : undefined}
                    >
                      <td onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={on} disabled={disabled} onChange={() => toggle(item.id)} style={{ cursor: 'pointer' }} />
                      </td>
                      <td style={{ fontSize: 13, color: '#787774' }}>{item.item_number}</td>
                      <td className="wrap-mobile" style={{ fontWeight: 500 }}>{item.title}</td>
                      <td style={{ fontSize: 13, color: '#787774' }}>{formatUnitLabel(item.unit)}</td>
                      <td><StatusBadge status={item.status} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center', padding: '10px 12px', background: '#f7f7f5', borderTop: '1px solid #e9e9e7' }}>
            <span style={{ fontSize: 13, color: '#787774', marginRight: 'auto' }}>
              {checked.size} item{checked.size !== 1 ? 's' : ''} ticked
            </span>
            <button className="btn btn-secondary" style={{ padding: '5px 10px', fontSize: 13 }} onClick={() => { setEditingItems(false); reset() }}>
              <X size={13} /> Cancel
            </button>
            <button className="btn btn-primary" style={{ padding: '5px 12px', fontSize: 13 }} onClick={handleSaveItems} disabled={busy === 'items' || checked.size === 0}>
              <Check size={13} /> {busy === 'items' ? 'Saving…' : 'Save items'}
            </button>
          </div>
        </div>
      ) : items.length === 0 ? (
        <div className="empty-state">
          <p style={{ fontWeight: 500 }}>No items on this work order</p>
          {editable && <p>Use “Edit items” to add some.</p>}
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Title</th>
              <th>Construction No.</th>
              <th>Address</th>
              <th>Owner</th>
              <th>Trade</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item: any) => {
              const unit = item.unit
              return (
                <tr key={item.id}>
                  <td>
                    <Link
                      href={`/maintenance/${item.id}`}
                      style={{ color: '#2383e2', fontWeight: 500, textDecoration: 'none', fontSize: 13 }}
                    >
                      {item.item_number}
                    </Link>
                  </td>
                  <td className="wrap-mobile" style={{ fontWeight: 500 }}>{item.title}</td>
                  <td style={{ fontSize: 13 }}>{unit?.unit_identifier ?? '—'}</td>
                  <td className="wrap-mobile" style={{ fontSize: 13, color: '#787774', maxWidth: 180 }}>{unit?.address ?? '—'}</td>
                  <td style={{ fontSize: 13 }}>
                    {unit?.owners?.length > 0
                      ? unit.owners.map((o: any) => o.name).join(', ')
                      : '—'}
                  </td>
                  <td style={{ fontSize: 13, color: '#787774' }}>{item.trade?.name ?? '—'}</td>
                  <td><StatusBadge status={item.status} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ border: '1px solid #e9e9e7', borderRadius: 8, padding: '14px 16px' }}>
      <h4 style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 600, color: '#787774', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {title}
      </h4>
      {children}
    </div>
  )
}
