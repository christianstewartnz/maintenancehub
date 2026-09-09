'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { WorkOrderStatusBadge, StatusBadge, PriorityBadge } from '@/components/ui/StatusBadge'
import { formatDate } from '@/lib/utils'
import { Download, Send, Pencil, Check, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

interface Props {
  workOrder: any
  items: any[]
}

export default function WorkOrderDetailClient({ workOrder: initial, items }: Props) {
  const [workOrder, setWorkOrder] = useState(initial)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesValue, setNotesValue] = useState(initial.notes ?? '')
  const [savingNotes, setSavingNotes] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  const project = workOrder.project
  const contractor = workOrder.contractor

  async function handleSend() {
    setSending(true)
    setError('')
    setSuccess('')
    const res = await fetch(`/api/work-orders/${workOrder.id}/send`, { method: 'POST' })
    const json = await res.json()
    if (!res.ok) {
      setError(json.error ?? 'Failed to send work order.')
      setSending(false)
      return
    }
    setWorkOrder((prev: any) => ({ ...prev, status: 'sent', sent_at: new Date().toISOString() }))
    setSuccess(`Work order sent to ${contractor?.email}`)
    setSending(false)
    router.refresh()
  }

  async function handleSaveNotes() {
    setSavingNotes(true)
    const { data } = await supabase
      .from('work_orders')
      .update({ notes: notesValue || null })
      .eq('id', workOrder.id)
      .select()
      .single()
    if (data) {
      setWorkOrder((prev: any) => ({ ...prev, notes: data.notes }))
      setEditingNotes(false)
    }
    setSavingNotes(false)
  }

  return (
    <div className="page-content" style={{ padding: '24px 32px' }}>
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
            <p style={{ margin: '2px 0 0', fontSize: 13, color: '#787774' }}>Sent {formatDate(workOrder.sent_at)}</p>
          )}
        </InfoCard>
      </div>

      {/* Notes — editable */}
      <div style={{ background: '#f7f7f5', border: '1px solid #e9e9e7', borderRadius: 8, padding: '12px 16px', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: editingNotes ? 8 : workOrder.notes ? 6 : 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#787774', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Notes</div>
          {!editingNotes && (
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
              <button className="btn btn-primary" style={{ padding: '5px 12px', fontSize: 13 }} onClick={handleSaveNotes} disabled={savingNotes}>
                <Check size={13} /> {savingNotes ? 'Saving…' : 'Save'}
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
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, color: '#37352f', fontWeight: 500 }}>
          {items.length} item{items.length !== 1 ? 's' : ''}
        </span>
        <div style={{ flex: 1 }} />
        {error && <span style={{ fontSize: 13, color: '#e03131' }}>{error}</span>}
        {success && <span style={{ fontSize: 13, color: '#2f9e44' }}>{success}</span>}
        <a href={`/api/work-orders/${workOrder.id}/pdf`} target="_blank" rel="noreferrer">
          <button className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Download size={15} /> Download PDF
          </button>
        </a>
        {workOrder.status === 'draft' && (
          <button
            className="btn btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            onClick={handleSend}
            disabled={sending || !contractor?.email}
            title={!contractor?.email ? 'Contractor has no email address' : undefined}
          >
            <Send size={15} />
            {sending ? 'Sending…' : `Send to ${contractor?.company_name}`}
          </button>
        )}
      </div>

      {/* Items table */}
      {items.length === 0 ? (
        <div className="empty-state">
          <p style={{ fontWeight: 500 }}>No items on this work order</p>
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Title</th>
              <th>Unit</th>
              <th>Address</th>
              <th>Owner</th>
              <th>Trade</th>
              <th>Status</th>
              <th>Priority</th>
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
                  <td style={{ fontWeight: 500 }}>{item.title}</td>
                  <td style={{ fontSize: 13 }}>{unit?.unit_identifier ?? '—'}</td>
                  <td style={{ fontSize: 13, color: '#787774', maxWidth: 180 }}>{unit?.address ?? '—'}</td>
                  <td style={{ fontSize: 13 }}>
                    {unit?.owner_name ?? '—'}
                    {unit?.owner_phone && (
                      <span style={{ color: '#787774' }}> · {unit.owner_phone}</span>
                    )}
                  </td>
                  <td style={{ fontSize: 13, color: '#787774' }}>{item.trade?.name ?? '—'}</td>
                  <td><StatusBadge status={item.status} /></td>
                  <td><PriorityBadge priority={item.priority} /></td>
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
