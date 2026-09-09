'use client'

import { useState } from 'react'
import { StatusBadge, PriorityBadge } from '@/components/ui/StatusBadge'
import { formatDateTime, STATUS_LABELS, nextStatus } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { MaintenanceItem, ActivityLog, ContractorComment, MaintenanceItemAttachment, MaintenanceStatus, Priority, Trade } from '@/lib/types'
import { Pencil } from 'lucide-react'

interface Props {
  item: MaintenanceItem & { unit: any; trade: any; contractor: any; work_order: any }
  activity: ActivityLog[]
  comments: ContractorComment[]
  attachments: MaintenanceItemAttachment[]
  contractors: { id: string; company_name: string }[]
  trades: Trade[]
}

const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'urgent']
const PRIORITY_LABELS: Record<Priority, string> = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' }

export default function ItemDetailClient({ item: initial, activity: initialActivity, comments: initialComments, contractors, trades }: Props) {
  const [item, setItem] = useState(initial)
  const [activity, setActivity] = useState(initialActivity)
  const [comments, setComments] = useState(initialComments)
  const [comment, setComment] = useState('')
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const [assigningContractor, setAssigningContractor] = useState(false)
  const [selectedContractor, setSelectedContractor] = useState(item.contractor_id ?? '')
  const [showEditModal, setShowEditModal] = useState(false)
  const [editForm, setEditForm] = useState({ title: item.title, description: item.description ?? '', priority: item.priority, trade_id: item.trade_id ?? '' })
  const [saving, setSaving] = useState(false)
  const [scheduledDate, setScheduledDate] = useState(item.scheduled_date ?? '')
  const [savingDate, setSavingDate] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  const next = nextStatus(item.status)

  async function advanceStatus() {
    if (!next) return
    setUpdatingStatus(true)
    const { data } = await supabase.from('maintenance_items').update({ status: next }).eq('id', item.id).select().single()
    if (data) {
      setItem(prev => ({ ...prev, status: next }))
      setActivity(prev => [{
        id: Math.random().toString(),
        maintenance_item_id: item.id,
        action: 'status_changed',
        details: { from: item.status, to: next },
        performed_by: 'admin',
        created_at: new Date().toISOString(),
      }, ...prev])
    }
    setUpdatingStatus(false)
  }

  async function handleAssignContractor() {
    if (!selectedContractor) return
    setAssigningContractor(true)
    const newStatus: MaintenanceStatus = item.status === 'logged' ? 'assigned' : item.status
    const { data } = await supabase
      .from('maintenance_items')
      .update({ contractor_id: selectedContractor, status: newStatus })
      .eq('id', item.id)
      .select('*, contractor:contractors(id, company_name, contact_name, email, phone)')
      .single()
    if (data) setItem(prev => ({ ...prev, ...data }))
    setAssigningContractor(false)
  }

  async function submitComment() {
    if (!comment.trim()) return
    const { data } = await supabase
      .from('contractor_comments')
      .insert({ maintenance_item_id: item.id, author: 'admin', content: comment })
      .select()
      .single()
    if (data) { setComments(prev => [...prev, data]); setComment('') }
  }

  async function saveScheduledDate(date: string) {
    setSavingDate(true)
    await supabase
      .from('maintenance_items')
      .update({ scheduled_date: date || null })
      .eq('id', item.id)
    setItem(prev => ({ ...prev, scheduled_date: date || null }))
    setSavingDate(false)
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const { data, error } = await supabase
      .from('maintenance_items')
      .update({
        title: editForm.title,
        description: editForm.description || null,
        priority: editForm.priority,
        trade_id: editForm.trade_id || null,
      })
      .eq('id', item.id)
      .select('*, trade:trades(id, name), contractor:contractors(id, company_name, contact_name, email, phone)')
      .single()
    if (!error && data) {
      setItem(prev => ({ ...prev, ...data }))
      setShowEditModal(false)
      router.refresh()
    }
    setSaving(false)
  }

  function openEdit() {
    setEditForm({ title: item.title, description: item.description ?? '', priority: item.priority, trade_id: item.trade_id ?? '' })
    setShowEditModal(true)
  }

  const unit = item.unit as any
  const trade = item.trade as any
  const contractor = item.contractor as any
  const workOrder = item.work_order as any

  return (
    <div className="page-content item-detail-grid" style={{ padding: '24px 32px', display: 'grid', gridTemplateColumns: '1fr 320px', gap: 24, alignItems: 'start' }}>
      {/* Main content */}
      <div>
        {/* Title & status */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <StatusBadge status={item.status} />
            <PriorityBadge priority={item.priority} />
            <button
              className="btn btn-ghost"
              style={{ marginLeft: 'auto', padding: '4px 8px', fontSize: 13, color: '#787774', display: 'flex', alignItems: 'center', gap: 5 }}
              onClick={openEdit}
            >
              <Pencil size={13} /> Edit
            </button>
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 8px', color: '#37352f' }}>{item.title}</h2>
          {item.description && <p style={{ color: '#37352f', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{item.description}</p>}
        </div>

        {/* Status advancement */}
        {next && (
          <div style={{ background: '#f7f7f5', border: '1px solid #e9e9e7', borderRadius: 8, padding: '14px 16px', marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 14, color: '#787774' }}>
              Advance to <strong style={{ color: '#37352f' }}>{STATUS_LABELS[next]}</strong>
            </span>
            <button className="btn btn-primary" onClick={advanceStatus} disabled={updatingStatus}>
              {updatingStatus ? 'Updating…' : `Mark as ${STATUS_LABELS[next]}`}
            </button>
          </div>
        )}

        {/* Comments */}
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: '#37352f', marginBottom: 12 }}>Comments</h3>
          {comments.length === 0 && <p style={{ color: '#787774', fontSize: 14 }}>No comments yet.</p>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
            {comments.map(c => (
              <div key={c.id} style={{ background: '#f7f7f5', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontWeight: 500, fontSize: 13 }}>{c.author}</span>
                  <span style={{ color: '#787774', fontSize: 12 }}>{formatDateTime(c.created_at)}</span>
                </div>
                <p style={{ margin: 0, fontSize: 14, whiteSpace: 'pre-wrap' }}>{c.content}</p>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <textarea className="input" value={comment} onChange={e => setComment(e.target.value)} placeholder="Add a comment…" style={{ minHeight: 68 }} />
          </div>
          <button className="btn btn-secondary" style={{ marginTop: 8 }} onClick={submitComment} disabled={!comment.trim()}>Add Comment</button>
        </div>

        {/* Activity log */}
        <div style={{ marginTop: 28 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: '#37352f', marginBottom: 12 }}>Activity</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {activity.map(log => (
              <div key={log.id} style={{ display: 'flex', gap: 10, fontSize: 13 }}>
                <span style={{ color: '#787774', whiteSpace: 'nowrap' }}>{formatDateTime(log.created_at)}</span>
                <span style={{ color: '#787774' }}>{log.performed_by}</span>
                <span style={{ color: '#37352f' }}>{formatActivityLog(log)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Sidebar */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <InfoCard title="Location">
          <Row label="Project" value={unit?.project?.name} href={`/projects/${unit?.project?.id}`} />
          <Row label="Unit" value={unit?.unit_identifier} />
          <Row label="Lot" value={unit?.lot_number} />
          <Row label="Address" value={unit?.address} />
          {unit?.settlement_date && (() => {
            const due = new Date(unit.settlement_date)
            due.setDate(due.getDate() + 90)
            const daysUntil = Math.ceil((due.getTime() - Date.now()) / 86400000)
            const dueStr = due.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
            const color = daysUntil < 0 ? '#eb5757' : daysUntil <= 14 ? '#d09c3a' : undefined
            return <>
              <div style={{ borderTop: '1px solid #f1f1ef', margin: '8px 0' }} />
              <Row label="Settlement" value={new Date(unit.settlement_date).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })} />
              <Row label="Maint. Due" value={`${dueStr}${daysUntil < 0 ? ` (${Math.abs(daysUntil)}d overdue)` : daysUntil <= 14 ? ` (${daysUntil}d)` : ''}`} valueColor={color} />
            </>
          })()}
        </InfoCard>

        <InfoCard title="Owner / Access">
          <Row label="Owner" value={unit?.owner_name} />
          <Row label="Phone" value={unit?.owner_phone} />
          <Row label="Email" value={unit?.owner_email} />
          {unit?.access_contact_name && <>
            <div style={{ borderTop: '1px solid #f1f1ef', margin: '8px 0' }} />
            <Row label="Access" value={unit?.access_contact_name} />
            <Row label="Phone" value={unit?.access_contact_phone} />
          </>}
        </InfoCard>

        <InfoCard title="Trade">
          <Row label="Category" value={trade?.name} />
        </InfoCard>

        <InfoCard title="Contractor">
          <div style={{ marginBottom: 8 }}>
            <select
              className="input"
              value={selectedContractor}
              onChange={e => setSelectedContractor(e.target.value)}
            >
              <option value="">Unassigned</option>
              {contractors.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            </select>
          </div>
          {selectedContractor !== (item.contractor_id ?? '') && (
            <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={handleAssignContractor} disabled={assigningContractor}>
              {assigningContractor ? 'Saving…' : 'Assign'}
            </button>
          )}
          {contractor && (
            <div style={{ marginTop: 8 }}>
              <Row label="Contact" value={contractor.contact_name} />
              <Row label="Email" value={contractor.email} />
              <Row label="Phone" value={contractor.phone} />
            </div>
          )}
        </InfoCard>

        {workOrder && (
          <InfoCard title="Work Order">
            <Row label="#" value={workOrder.work_order_number} href={`/work-orders/${workOrder.id}`} />
          </InfoCard>
        )}

        <InfoCard title="Scheduled Date">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="date"
              className="input"
              value={scheduledDate}
              onChange={e => setScheduledDate(e.target.value)}
              style={{ flex: 1, fontSize: 13 }}
            />
            <button
              className="btn btn-primary"
              style={{ padding: '6px 12px', fontSize: 13, whiteSpace: 'nowrap' }}
              disabled={savingDate || scheduledDate === (item.scheduled_date ?? '')}
              onClick={() => saveScheduledDate(scheduledDate)}
            >
              {savingDate ? '…' : 'Save'}
            </button>
          </div>
          {scheduledDate && (
            <button
              className="btn btn-ghost"
              style={{ marginTop: 6, fontSize: 12, color: '#787774', padding: '2px 0' }}
              onClick={() => { setScheduledDate(''); saveScheduledDate('') }}
            >
              Clear date
            </button>
          )}
        </InfoCard>

        <InfoCard title="Details">
          <Row label="Item #" value={item.item_number} />
          <Row label="Created" value={formatDateTime(item.created_at)} />
          <Row label="Updated" value={formatDateTime(item.updated_at)} />
          {item.completed_at && <Row label="Completed" value={formatDateTime(item.completed_at)} />}
        </InfoCard>
      </div>

      {/* Edit modal */}
      {showEditModal && (
        <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Edit Item</h2>
              <button className="btn btn-ghost" style={{ padding: '4px 8px' }} onClick={() => setShowEditModal(false)}>✕</button>
            </div>
            <form onSubmit={handleSaveEdit}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={labelStyle}>Title *</label>
                  <input className="input" required value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} />
                </div>
                <div>
                  <label style={labelStyle}>Description</label>
                  <textarea className="input" value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} style={{ minHeight: 80 }} />
                </div>
                <div>
                  <label style={labelStyle}>Priority</label>
                  <select className="input" value={editForm.priority} onChange={e => setEditForm(f => ({ ...f, priority: e.target.value as Priority }))}>
                    {PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
                  </select>
                </div>
                {trades.length > 0 && (
                  <div>
                    <label style={labelStyle}>Trade</label>
                    <select className="input" value={editForm.trade_id} onChange={e => setEditForm(f => ({ ...f, trade_id: e.target.value }))}>
                      <option value="">No trade</option>
                      {trades.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowEditModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ border: '1px solid #e9e9e7', borderRadius: 8, padding: '14px 16px' }}>
      <h4 style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 600, color: '#787774', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</h4>
      {children}
    </div>
  )
}

function Row({ label, value, href, valueColor }: { label: string; value?: string | null; href?: string; valueColor?: string }) {
  if (!value) return null
  return (
    <div style={{ display: 'flex', gap: 8, fontSize: 13, marginBottom: 4 }}>
      <span style={{ color: '#787774', minWidth: 60, flexShrink: 0 }}>{label}</span>
      {href ? <a href={href} style={{ color: '#2383e2', textDecoration: 'none' }}>{value}</a> : <span style={{ color: valueColor ?? '#37352f', fontWeight: valueColor ? 500 : undefined }}>{value}</span>}
    </div>
  )
}

function formatActivityLog(log: ActivityLog): string {
  const d = log.details as any
  switch (log.action) {
    case 'status_changed': return `changed status from ${STATUS_LABELS[d?.from as MaintenanceStatus] ?? d?.from} to ${STATUS_LABELS[d?.to as MaintenanceStatus] ?? d?.to}`
    case 'contractor_assigned': return 'assigned contractor'
    case 'work_order_added': return 'added to work order'
    case 'item_created': return `created item "${d?.title}"`
    case 'comment_added': return 'added a comment'
    default: return log.action.replace(/_/g, ' ')
  }
}

const labelStyle: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 5, color: '#37352f' }
