'use client'

import { useState } from 'react'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { formatDateTime, STATUS_LABELS, nextStatus } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { MaintenanceItem, MaintenanceItemTrade, ActivityLog, ContractorComment, ItemUpdate, MaintenanceItemAttachment, MaintenanceStatus, Trade, Profile } from '@/lib/types'
import { profileName } from '@/lib/assignees'
import { Pencil, Mail, CheckCircle2, RotateCcw, Archive, ArchiveRestore, X } from 'lucide-react'
import ItemPhotos from '@/components/ui/ItemPhotos'
import { ATTACHMENTS_BUCKET, SIGNED_URL_TTL_SECONDS, photoStoragePath, type PhotoWithUrl } from '@/lib/photos'
import type { PhotoType } from '@/lib/types'

interface Props {
  item: MaintenanceItem & { unit: any; trade: any; contractor: any; work_order: any }
  activity: ActivityLog[]
  comments: ContractorComment[]
  updates: ItemUpdate[]
  attachments: (MaintenanceItemAttachment & { url: string | null })[]
  contractors: { id: string; company_name: string }[]
  trades: Trade[]
  /** The project's default contractor per trade, used to pre-fill additional trades. */
  tradeAssignments: { trade_id: string; contractor_id: string }[]
  users: Profile[]
  currentUserId: string
}

const EXTRA_TRADE_SELECT = 'id, maintenance_item_id, trade_id, contractor_id, status, scheduled_date, completed_at, sort_order, created_at, trade:trades(id, name), contractor:contractors(id, company_name)'

export default function ItemDetailClient({ item: initial, activity: initialActivity, comments: initialComments, updates, attachments, contractors, trades, tradeAssignments, users, currentUserId }: Props) {
  const [item, setItem] = useState(initial)
  const [extraTrades, setExtraTrades] = useState<MaintenanceItemTrade[]>(initial.extra_trades ?? [])
  const [addingTradeId, setAddingTradeId] = useState('')
  const [savingExtra, setSavingExtra] = useState<string | null>(null)
  const [activity, setActivity] = useState(initialActivity)
  const [comments, setComments] = useState(initialComments)
  const [comment, setComment] = useState('')
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const [assigningContractor, setAssigningContractor] = useState(false)
  const [selectedContractor, setSelectedContractor] = useState(item.contractor_id ?? '')
  const [showEditModal, setShowEditModal] = useState(false)
  const [editForm, setEditForm] = useState({ title: item.title, description: item.description ?? '', trade_id: item.trade_id ?? '' })
  const [saving, setSaving] = useState(false)
  const [scheduledDate, setScheduledDate] = useState(item.scheduled_date ?? '')
  const [savingDate, setSavingDate] = useState(false)
  const [savingAssignee, setSavingAssignee] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  const next = nextStatus(item.status)

  async function setStatus(to: MaintenanceStatus) {
    if (to === item.status) return
    // Signing the item off signs off its additional trades too
    const unfinished = to === 'complete' ? extraTrades.filter(t => t.status !== 'complete') : []
    if (unfinished.length && !confirm(`This will also mark ${unfinished.map(t => t.trade?.name ?? 'trade').join(', ')} as complete. Continue?`)) return
    setUpdatingStatus(true)
    if (unfinished.length) {
      await supabase.from('maintenance_item_trades').update({ status: 'complete' }).in('id', unfinished.map(t => t.id))
      setExtraTrades(prev => prev.map(t => ({ ...t, status: 'complete' })))
    }
    const completed_at = to === 'complete' ? new Date().toISOString() : null
    const { data } = await supabase.from('maintenance_items').update({ status: to, completed_at }).eq('id', item.id).select().single()
    if (data) {
      setItem(prev => ({ ...prev, status: to, completed_at: data.completed_at ?? completed_at }))
      setActivity(prev => [{
        id: Math.random().toString(),
        maintenance_item_id: item.id,
        action: 'status_changed',
        details: { from: item.status, to },
        performed_by: 'admin',
        created_at: new Date().toISOString(),
      }, ...prev])
      router.refresh()
    }
    setUpdatingStatus(false)
  }

  function advanceStatus() {
    if (next) setStatus(next)
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

  // ---- Additional trades ----

  function logLocal(action: string, details: Record<string, unknown>) {
    setActivity(prev => [{
      id: Math.random().toString(),
      maintenance_item_id: item.id,
      action,
      details,
      performed_by: 'admin',
      created_at: new Date().toISOString(),
    }, ...prev])
  }

  async function addExtraTrade(tradeId: string) {
    if (!tradeId) return
    setSavingExtra('new')
    // Pre-fill the project's usual contractor for this trade
    const contractorId = tradeAssignments.find(a => a.trade_id === tradeId)?.contractor_id ?? null
    const sortOrder = extraTrades.reduce((m, t) => Math.max(m, t.sort_order), 0) + 1
    const { data, error } = await supabase
      .from('maintenance_item_trades')
      .insert({ maintenance_item_id: item.id, trade_id: tradeId, contractor_id: contractorId, status: contractorId ? 'assigned' : 'logged', sort_order: sortOrder })
      .select(EXTRA_TRADE_SELECT)
      .single()
    if (error || !data) {
      alert(`Couldn't add trade: ${error?.message ?? 'unknown error'}`)
    } else {
      const row = data as unknown as MaintenanceItemTrade
      setExtraTrades(prev => [...prev, row])
      logLocal('trade_added', { trade: row.trade?.name, contractor: row.contractor?.company_name })
    }
    setAddingTradeId('')
    setSavingExtra(null)
  }

  async function updateExtraTrade(row: MaintenanceItemTrade, patch: Partial<Pick<MaintenanceItemTrade, 'contractor_id' | 'status'>>) {
    // Same rule as the main contractor: giving a logged trade a contractor moves it to Assigned, clearing it moves it back
    if ('contractor_id' in patch && !('status' in patch)) {
      if (patch.contractor_id && row.status === 'logged') patch.status = 'assigned'
      else if (!patch.contractor_id && row.status === 'assigned') patch.status = 'logged'
    }
    setSavingExtra(row.id)
    const { data, error } = await supabase
      .from('maintenance_item_trades')
      .update(patch)
      .eq('id', row.id)
      .select(EXTRA_TRADE_SELECT)
      .single()
    if (error || !data) {
      alert(`Couldn't update trade: ${error?.message ?? 'unknown error'}`)
    } else {
      const updated = data as unknown as MaintenanceItemTrade
      setExtraTrades(prev => prev.map(t => t.id === row.id ? updated : t))
      if (patch.status && patch.status !== row.status) logLocal('trade_status_changed', { trade: updated.trade?.name, from: row.status, to: patch.status })
      if ('contractor_id' in patch && patch.contractor_id && patch.contractor_id !== row.contractor_id) logLocal('trade_contractor_assigned', { trade: updated.trade?.name, contractor: updated.contractor?.company_name })
    }
    setSavingExtra(null)
  }

  async function removeExtraTrade(row: MaintenanceItemTrade) {
    if (!confirm(`Remove ${row.trade?.name ?? 'this trade'} from ${item.item_number}?${row.contractor ? ` It will disappear from ${row.contractor.company_name}'s portal.` : ''}`)) return
    setSavingExtra(row.id)
    const { error } = await supabase.from('maintenance_item_trades').delete().eq('id', row.id)
    if (error) {
      alert(`Couldn't remove trade: ${error.message}`)
    } else {
      setExtraTrades(prev => prev.filter(t => t.id !== row.id))
      logLocal('trade_removed', { trade: row.trade?.name })
    }
    setSavingExtra(null)
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

  async function saveAssignee(assignedTo: string | null) {
    setSavingAssignee(true)
    const { error } = await supabase.from('maintenance_items').update({ assigned_to: assignedTo }).eq('id', item.id)
    if (error) {
      alert(`Couldn't update assignment: ${error.message}`)
    } else {
      const user = users.find(u => u.id === assignedTo)
      setItem(prev => ({ ...prev, assigned_to: assignedTo }))
      setActivity(prev => [{
        id: Math.random().toString(),
        maintenance_item_id: item.id,
        action: 'assignee_changed',
        details: { from: item.assigned_to, to: assignedTo, to_name: user ? profileName(user) : null },
        performed_by: 'admin',
        created_at: new Date().toISOString(),
      }, ...prev])
    }
    setSavingAssignee(false)
  }

  async function toggleArchive() {
    const archive = !item.archived_at
    if (archive && !confirm(`Archive ${item.item_number}? It will be hidden from lists, the dashboard and the contractor portal. You can restore it later.`)) return
    setArchiving(true)
    const archived_at = archive ? new Date().toISOString() : null
    const { error } = await supabase.from('maintenance_items').update({ archived_at }).eq('id', item.id)
    if (error) {
      alert(`Couldn't ${archive ? 'archive' : 'restore'} item: ${error.message}`)
    } else {
      setItem(prev => ({ ...prev, archived_at }))
      const me = users.find(u => u.id === currentUserId)
      logActivity(archive ? 'item_archived' : 'item_restored', {}, me ? profileName(me) : 'admin')
      router.refresh()
    }
    setArchiving(false)
  }

  function logActivity(action: string, details: Record<string, unknown>, performedBy: string) {
    setActivity(prev => [{
      id: Math.random().toString(),
      maintenance_item_id: item.id,
      action,
      details,
      performed_by: performedBy,
      created_at: new Date().toISOString(),
    }, ...prev])
    // Best-effort: the photo is saved either way
    supabase.from('activity_log').insert({ maintenance_item_id: item.id, action, details, performed_by: performedBy }).then(() => {})
  }

  async function uploadPhoto(blob: Blob, fileName: string, type: PhotoType): Promise<PhotoWithUrl | string> {
    const me = users.find(u => u.id === currentUserId)
    const uploadedBy = me ? profileName(me) : 'admin'
    const contentType = blob.type || 'image/jpeg'
    const path = photoStoragePath(item.id, contentType)
    const { error: upErr } = await supabase.storage.from(ATTACHMENTS_BUCKET).upload(path, blob, { contentType })
    if (upErr) return upErr.message
    const { data: row, error: insErr } = await supabase
      .from('maintenance_item_attachments')
      .insert({ maintenance_item_id: item.id, file_url: path, file_type: contentType, file_name: fileName, uploaded_by: uploadedBy, photo_type: type })
      .select()
      .single()
    if (insErr || !row) {
      await supabase.storage.from(ATTACHMENTS_BUCKET).remove([path])
      return insErr?.message ?? 'Could not save photo'
    }
    const { data: signed } = await supabase.storage.from(ATTACHMENTS_BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
    logActivity('photo_added', { photo_type: type, file_name: fileName }, uploadedBy)
    return { ...row, url: signed?.signedUrl ?? null }
  }

  async function deletePhoto(photo: PhotoWithUrl): Promise<string | null> {
    const { error } = await supabase.from('maintenance_item_attachments').delete().eq('id', photo.id)
    if (error) return error.message
    if (!/^https?:\/\//.test(photo.file_url)) await supabase.storage.from(ATTACHMENTS_BUCKET).remove([photo.file_url])
    return null
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
    const update: Record<string, unknown> = {
      title: editForm.title,
      description: editForm.description || null,
      trade_id: editForm.trade_id || null,
    }
    // Trade changed: switch to the project's contractor for the new trade (if it has one)
    const tradeChanged = (editForm.trade_id || null) !== item.trade_id
    const defaultContractorId = tradeChanged && editForm.trade_id
      ? tradeAssignments.find(a => a.trade_id === editForm.trade_id)?.contractor_id ?? null
      : null
    if (defaultContractorId) {
      update.contractor_id = defaultContractorId
      if (item.status === 'logged') update.status = 'assigned'
    }
    const { data, error } = await supabase
      .from('maintenance_items')
      .update(update)
      .eq('id', item.id)
      .select('*, trade:trades(id, name), contractor:contractors(id, company_name, contact_name, email, phone)')
      .single()
    if (!error && data) {
      setItem(prev => ({ ...prev, ...data }))
      setSelectedContractor(data.contractor_id ?? '')
      setShowEditModal(false)
      router.refresh()
    }
    setSaving(false)
  }

  function openEdit() {
    setEditForm({ title: item.title, description: item.description ?? '', trade_id: item.trade_id ?? '' })
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
            {item.archived_at && <span style={archivedPillStyle}>Archived</span>}
            <button
              className="btn btn-ghost"
              style={{ marginLeft: 'auto', padding: '4px 8px', fontSize: 13, color: '#787774', display: 'flex', alignItems: 'center', gap: 5 }}
              onClick={openEdit}
            >
              <Pencil size={13} /> Edit
            </button>
            <button
              className="btn btn-ghost"
              style={{ padding: '4px 8px', fontSize: 13, color: '#787774', display: 'flex', alignItems: 'center', gap: 5 }}
              onClick={toggleArchive}
              disabled={archiving}
            >
              {item.archived_at
                ? <><ArchiveRestore size={13} /> {archiving ? 'Restoring…' : 'Restore'}</>
                : <><Archive size={13} /> {archiving ? 'Archiving…' : 'Archive'}</>}
            </button>
          </div>
          {item.archived_at && (
            <div style={{ background: '#f7f7f5', border: '1px solid #e9e9e7', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#787774' }}>
              Archived {formatDateTime(item.archived_at)} — hidden from lists, the dashboard, sign-off and the contractor portal.
            </div>
          )}
          <h2 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 8px', color: '#37352f' }}>{item.title}</h2>
          {item.description && <p style={{ color: '#37352f', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{item.description}</p>}
        </div>

        {/* Status advancement */}
        {next ? (
          <div style={{ background: '#f7f7f5', border: '1px solid #e9e9e7', borderRadius: 8, padding: '14px 16px', marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, color: '#787774' }}>
              Advance to <strong style={{ color: '#37352f' }}>{STATUS_LABELS[next]}</strong>
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              {next !== 'complete' && (
                <button className="btn btn-secondary" onClick={advanceStatus} disabled={updatingStatus}>
                  {`Mark as ${STATUS_LABELS[next]}`}
                </button>
              )}
              <button className="btn btn-primary" onClick={() => setStatus('complete')} disabled={updatingStatus}>
                <CheckCircle2 size={15} /> {updatingStatus ? 'Updating…' : 'Mark Complete'}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ background: '#f2f9f4', border: '1px solid #d6ecdc', borderRadius: 8, padding: '14px 16px', marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, color: '#2f7d4a', display: 'flex', alignItems: 'center', gap: 6 }}>
              <CheckCircle2 size={15} /> Completed{item.completed_at ? ` ${formatDateTime(item.completed_at)}` : ''}
            </span>
            <button className="btn btn-ghost" style={{ color: '#787774', fontSize: 13 }} onClick={() => setStatus('in_progress')} disabled={updatingStatus}>
              <RotateCcw size={13} /> {updatingStatus ? 'Updating…' : 'Reopen'}
            </button>
          </div>
        )}

        {/* Inspection / completion photos */}
        <div style={{ marginBottom: 28 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: '#37352f', marginBottom: 4 }}>Photos</h3>
          <p style={{ color: '#787774', fontSize: 12, margin: '0 0 12px' }}>
            Inspection photos are taken by us on site; completion photos are added by the contractor when the job is done. Contractors see both in their portal.
          </p>
          <ItemPhotos
            initialPhotos={attachments}
            uploadTypes={['before', 'after']}
            onUpload={uploadPhoto}
            onDelete={deletePhoto}
            hints={{ before: 'Add photos taken at inspection.', after: 'The contractor adds these from their portal when the job is done.' }}
          />
        </div>

        {/* Email updates (internal — not shown in the contractor portal) */}
        {updates.length > 0 && (
          <div style={{ marginBottom: 28 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: '#37352f', marginBottom: 4 }}>Email updates</h3>
            <p style={{ color: '#787774', fontSize: 12, margin: '0 0 12px' }}>Added by Claude from your emails. Internal only — contractors can't see these.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {updates.map(u => (
                <div key={u.id} style={{ background: '#f2f7fd', borderLeft: '3px solid #2383e2', borderRadius: 8, padding: '10px 14px' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                    <Mail size={13} color="#2383e2" />
                    <span style={{ fontWeight: 500, fontSize: 13 }}>Claude</span>
                    <span style={{ color: '#787774', fontSize: 12 }}>{formatDateTime(u.created_at)}</span>
                    {u.status_to && (
                      <span style={{ fontSize: 12, color: '#37352f' }}>
                        · {STATUS_LABELS[u.status_from as MaintenanceStatus] ?? u.status_from} → <strong>{STATUS_LABELS[u.status_to as MaintenanceStatus] ?? u.status_to}</strong>
                      </span>
                    )}
                  </div>
                  <p style={{ margin: 0, fontSize: 14, whiteSpace: 'pre-wrap' }}>{u.content}</p>
                  {(u.email_subject || u.email_from) && (
                    <div style={{ marginTop: 6, fontSize: 12, color: '#787774' }}>
                      {u.email_from && <>From {u.email_from}{u.email_to ? ` to ${u.email_to}` : ''}</>}
                      {u.email_date && <> · {formatDateTime(u.email_date)}</>}
                      {u.email_subject && <> · “{u.email_subject}”</>}
                    </div>
                  )}
                </div>
              ))}
            </div>
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
        <InfoCard title="Assigned to">
          <select
            className="input"
            value={item.assigned_to ?? ''}
            onChange={e => saveAssignee(e.target.value || null)}
            disabled={savingAssignee}
          >
            <option value="">Unassigned (everyone)</option>
            {users.map(u => <option key={u.id} value={u.id}>{profileName(u)}{u.id === currentUserId ? ' (me)' : ''}</option>)}
          </select>
          {item.assigned_to !== currentUserId && (
            <button
              className="btn btn-ghost"
              style={{ marginTop: 6, fontSize: 12, color: '#2383e2', padding: '2px 0' }}
              onClick={() => saveAssignee(currentUserId)}
              disabled={savingAssignee || !currentUserId}
            >
              Assign to me
            </button>
          )}
        </InfoCard>

        <InfoCard title="Location">
          <Row label="Project" value={unit?.project?.name} href={`/projects/${unit?.project?.id}`} />
          <Row label="Construction No." value={unit?.unit_identifier} />
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
          {(unit?.owners ?? []).map((o: any, i: number) => (
            <div key={o.id} style={i > 0 ? { marginTop: 8 } : undefined}>
              <Row label={i === 0 ? 'Owner' : ''} value={o.name} />
              {o.phone && <Row label="" value={o.phone} />}
              {o.email && <Row label="" value={o.email} />}
            </div>
          ))}
          {(!unit?.owners || unit.owners.length === 0) && <Row label="Owner" value={undefined} />}
          {unit?.access_contact_name && <>
            <div style={{ borderTop: '1px solid #f1f1ef', margin: '8px 0' }} />
            <Row label="Access" value={unit?.access_contact_name} />
            <Row label="Phone" value={unit?.access_contact_phone} />
          </>}
        </InfoCard>

        <InfoCard title={extraTrades.length ? 'Trades' : 'Trade'}>
          <div style={{ display: 'flex', gap: 8, fontSize: 13, marginBottom: extraTrades.length ? 10 : 4, alignItems: 'baseline' }}>
            {extraTrades.length > 0 && <span style={tradeNumStyle}>1</span>}
            <span style={{ color: trade?.name ? '#37352f' : '#b0aea8', fontWeight: 500 }}>{trade?.name ?? 'No trade'}</span>
            <span style={{ color: '#787774', fontSize: 12, marginLeft: 'auto' }}>{contractor?.company_name ?? 'see Contractor'}</span>
          </div>

          {extraTrades.map((t, i) => (
            <div key={t.id} style={{ borderTop: '1px solid #f1f1ef', padding: '10px 0 6px' }}>
              <div style={{ display: 'flex', gap: 8, fontSize: 13, alignItems: 'baseline', marginBottom: 6 }}>
                <span style={tradeNumStyle}>{i + 2}</span>
                <span style={{ color: '#37352f', fontWeight: 500 }}>{t.trade?.name ?? 'Trade'}</span>
                <button
                  className="btn btn-ghost"
                  title="Remove trade"
                  style={{ marginLeft: 'auto', padding: '0 4px', fontSize: 12, color: '#787774' }}
                  onClick={() => removeExtraTrade(t)}
                  disabled={savingExtra === t.id}
                >
                  <X size={13} />
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <select
                  className="input"
                  aria-label={`${t.trade?.name} contractor`}
                  value={t.contractor_id ?? ''}
                  onChange={e => updateExtraTrade(t, { contractor_id: e.target.value || null })}
                  disabled={savingExtra === t.id}
                  style={{ fontSize: 13 }}
                >
                  <option value="">No contractor</option>
                  {contractors.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
                </select>
                <select
                  className="input"
                  aria-label={`${t.trade?.name} status`}
                  value={t.status}
                  onChange={e => updateExtraTrade(t, { status: e.target.value as MaintenanceStatus })}
                  disabled={savingExtra === t.id}
                  style={{ fontSize: 13 }}
                >
                  {(['logged', 'assigned', 'in_progress', 'contractor_complete', 'complete'] as MaintenanceStatus[]).map(s => (
                    <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                  ))}
                </select>
              </div>
            </div>
          ))}

          {(() => {
            const used = new Set([item.trade_id, ...extraTrades.map(t => t.trade_id)])
            const available = trades.filter(t => !used.has(t.id))
            if (!available.length) return null
            return (
              <div style={{ borderTop: '1px solid #f1f1ef', paddingTop: 10, marginTop: 4 }}>
                <select
                  className="input"
                  aria-label="Add another trade"
                  value={addingTradeId}
                  onChange={e => { setAddingTradeId(e.target.value); addExtraTrade(e.target.value) }}
                  disabled={savingExtra === 'new'}
                  style={{ fontSize: 13, color: '#787774' }}
                >
                  <option value="">{savingExtra === 'new' ? 'Adding…' : '+ Add another trade…'}</option>
                  {available.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                {extraTrades.length === 0 && (
                  <p style={{ margin: '6px 0 0', fontSize: 12, color: '#787774' }}>
                    For jobs that need more than one trade, e.g. a builder to refix then a painter to make good. Each trade gets its own contractor and shows in their portal.
                  </p>
                )}
              </div>
            )
          })()}
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
    case 'contractor_notified': return d?.method === 'email'
      ? `emailed ${d?.contractor ?? 'the contractor'} about this item`
      : `marked ${d?.contractor ?? 'the contractor'} as told about this item`
    case 'assignee_changed': return d?.to ? `assigned item to ${d?.to_name ?? 'a user'}` : 'unassigned item'
    case 'item_created': return `created item "${d?.title}"`
    case 'comment_added': return 'added a comment'
    case 'photo_added': return d?.photo_type === 'before' ? 'added an inspection photo'
      : d?.photo_type === 'after' ? 'added a completion photo'
      : 'added a photo'
    case 'item_archived': return 'archived item'
    case 'item_restored': return 'restored item from archive'
    case 'trade_added': return `added trade ${d?.trade ?? ''}${d?.contractor ? ` (${d.contractor})` : ''}`
    case 'trade_removed': return `removed trade ${d?.trade ?? ''}`
    case 'trade_contractor_assigned': return `assigned ${d?.contractor ?? 'a contractor'} to ${d?.trade ?? 'a trade'}`
    case 'trade_status_changed': return `changed ${d?.trade ?? 'trade'} from ${STATUS_LABELS[d?.from as MaintenanceStatus] ?? d?.from} to ${STATUS_LABELS[d?.to as MaintenanceStatus] ?? d?.to}`
    case 'email_update': return `added an email update${d?.email_subject ? ` (“${d.email_subject}”)` : ''}`
    default: return log.action.replace(/_/g, ' ')
  }
}

const archivedPillStyle: React.CSSProperties = { fontSize: 12, fontWeight: 500, color: '#787774', background: '#f1f1ef', border: '1px solid #e9e9e7', borderRadius: 4, padding: '2px 8px' }

const tradeNumStyle: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: '#787774', background: '#f1f1ef', borderRadius: 10, minWidth: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }

const labelStyle: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 5, color: '#37352f' }
