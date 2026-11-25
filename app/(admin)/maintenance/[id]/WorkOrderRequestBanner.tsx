'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Receipt } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatDateTime, formatHours } from '@/lib/utils'
import type { WorkOrderRequest } from '@/lib/types'
import { COUNTS_CHANGED_EVENT } from '@/lib/contractor-notify'

interface Props {
  item: { id: string; item_number?: string; title?: string; contractor_id: string | null; work_order_id: string | null; unit: any }
  requests: WorkOrderRequest[]
  currentUserId: string
  /** Name to record in the activity log. */
  actorName: string
}

const money = (n: number) => `$${Number(n).toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** A request's items: the whole group when sent together, else just this item. */
function requestItems(r: WorkOrderRequest, item: Props['item']) {
  if (r.group?.length) {
    return r.group
      .filter(g => g.item)
      .map(g => ({ requestId: g.id, status: g.status, ...g.item! }))
      .sort((a, b) => a.item_number.localeCompare(b.item_number, undefined, { numeric: true }))
  }
  return [{
    requestId: r.id, status: r.status, id: item.id, item_number: item.item_number ?? '', title: item.title ?? '',
    work_order_id: item.work_order_id, archived_at: null as string | null, contractor_id: item.contractor_id,
  }]
}

/**
 * Contractor work order requests on this item (from the portal): the pending one with
 * Create work order / Decline, and the latest answered one for context. A request can
 * cover several items on the unit; it's answered as a whole.
 */
export default function WorkOrderRequestBanner({ item, requests, currentUserId, actorName }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const pending = requests.find(r => r.status === 'pending')
  const latestAnswered = requests.find(r => r.status !== 'pending')
  const shown = pending ?? latestAnswered
  if (!shown) return null

  const contractorName = shown.contractor?.company_name ?? 'The contractor'
  const shownItems = requestItems(shown, item)
  const multi = shownItems.length > 1

  /** Mark the given pending requests answered, and log it on each item. */
  async function answer(r: WorkOrderRequest, rows: { requestId: string; id: string }[], status: 'approved' | 'declined', note: string | null, workOrderId: string | null) {
    const { error } = await supabase
      .from('work_order_requests')
      .update({ status, response_note: note, responded_by: currentUserId || null, responded_at: new Date().toISOString(), work_order_id: workOrderId })
      .in('id', rows.map(x => x.requestId))
      .eq('status', 'pending')
    if (error) throw error
    await supabase.from('activity_log').insert(rows.map(x => ({
      maintenance_item_id: x.id,
      action: status === 'approved' ? 'work_order_request_approved' : 'work_order_request_declined',
      details: { contractor: r.contractor?.company_name ?? null, note },
      performed_by: actorName,
    })))
    // Sidebar Work Orders badge
    window.dispatchEvent(new Event(COUNTS_CHANGED_EVENT))
  }

  async function approve(r: WorkOrderRequest) {
    setBusy(true)
    setError('')
    try {
      // Still waiting and not archived (archived items drop out of the request).
      const rows = requestItems(r, item).filter(x => x.status === 'pending' && !x.archived_at)
      let woId = item.work_order_id ?? rows.find(x => x.work_order_id)?.work_order_id ?? null
      if (!woId) {
        const projectId = item.unit?.project?.id
        if (!projectId) throw new Error('This item has no project.')
        const { data: wo, error: woErr } = await supabase
          .from('work_orders')
          .insert({ project_id: projectId, contractor_id: r.contractor_id, status: 'draft', notes: null })
          .select('id')
          .single()
        if (woErr || !wo) throw woErr ?? new Error('Could not create the work order.')
        woId = wo.id
      }
      // All the request's items on the one work order (same unit by construction).
      const toLink = rows.filter(x => !x.work_order_id).map(x => x.id)
      if (toLink.length) {
        const { error: linkErr } = await supabase
          .from('maintenance_items')
          .update({ work_order_id: woId })
          .in('id', toLink)
          .is('work_order_id', null)
        if (linkErr) throw linkErr
      }
      await answer(r, rows, 'approved', null, woId)
      router.push(`/work-orders/${woId}`)
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong.')
      setBusy(false)
    }
  }

  async function decline(r: WorkOrderRequest) {
    const rows = requestItems(r, item).filter(x => x.status === 'pending')
    const what = rows.length > 1 ? ` (all ${rows.length} items)` : ''
    const note = window.prompt(`Decline ${r.contractor?.company_name ?? 'the contractor'}'s work order request${what}?\n\nOptional note for the contractor (shown on their portal):`, '')
    if (note === null) return
    setBusy(true)
    setError('')
    try {
      await answer(r, rows, 'declined', note.trim() || null, null)
      router.refresh()
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong.')
    }
    setBusy(false)
  }

  /** The request's items, when there's more than this one. */
  const itemList = multi && (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: pending ? '#8a5a00' : '#787774', marginBottom: 4 }}>
        {shownItems.length} items on this request
      </div>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#37352f' }}>
        {shownItems.map(x => (
          <li key={x.requestId} style={{ marginBottom: 2 }}>
            {x.id === item.id
              ? <strong>{x.item_number}</strong>
              : <Link href={`/maintenance/${x.id}`} style={{ color: '#2383e2', textDecoration: 'none' }}>{x.item_number}</Link>}
            {' — '}{x.title}
            {x.id === item.id && <span style={{ color: '#9b9a97' }}> (this item)</span>}
            {x.archived_at && <span style={{ color: '#a33a3a' }}> · archived</span>}
            {pending && x.work_order_id && x.id !== item.id && <span style={{ color: '#9b9a97' }}> · already on a work order</span>}
          </li>
        ))}
      </ul>
    </div>
  )

  if (!pending) {
    const approved = shown.status === 'approved'
    return (
      <div style={{ background: '#f7f7f5', border: '1px solid #e9e9e7', borderRadius: 8, padding: '10px 14px', marginBottom: 24, fontSize: 13, color: '#787774' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Receipt size={13} />
          {contractorName} requested a work order{multi ? ` for ${shownItems.length} items` : ''} {formatDateTime(shown.created_at)} —{' '}
          <strong style={{ color: approved ? '#2e7d32' : '#a33a3a' }}>{approved ? 'approved' : 'declined'}</strong>
          {shown.responded_at && ` ${formatDateTime(shown.responded_at)}`}
          {!approved && shown.response_note && <span>(“{shown.response_note}”)</span>}
          {approved && shown.work_order && (
            <Link href={`/work-orders/${shown.work_order.id}`} style={{ color: '#2383e2', textDecoration: 'none' }}>{shown.work_order.work_order_number}</Link>
          )}
        </div>
        {itemList}
      </div>
    )
  }

  const otherContractor = item.contractor_id && pending.contractor_id !== item.contractor_id
  return (
    <div style={{ background: '#fff8e6', border: '1px solid #f3e2b8', borderRadius: 8, padding: '14px 16px', marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 600, color: '#8a5a00' }}>
        <Receipt size={15} /> Work order requested by {contractorName}{multi ? ` (${shownItems.length} items)` : ''}
        <span style={{ fontWeight: 400, fontSize: 12, color: '#a07a2a', marginLeft: 'auto' }}>{formatDateTime(pending.created_at)}</span>
      </div>
      <blockquote style={{ margin: '10px 0 0', padding: '8px 12px', background: 'white', borderLeft: '3px solid #f3e2b8', borderRadius: '0 6px 6px 0', fontSize: 14, color: '#37352f', whiteSpace: 'pre-wrap' }}>
        {pending.reason}
      </blockquote>
      {(pending.estimated_hours != null || pending.estimated_cost != null) && (
        <p style={{ margin: '8px 0 0', fontSize: 13, color: '#37352f' }}>
          <strong>Estimate{multi ? ' (all items)' : ''}:</strong>{' '}
          {[
            pending.estimated_hours != null ? formatHours(pending.estimated_hours) : '',
            pending.estimated_cost != null ? `${money(pending.estimated_cost)} + GST` : '',
          ].filter(Boolean).join(' · ')}
        </p>
      )}
      {itemList}
      {otherContractor && (
        <p style={{ margin: '8px 0 0', fontSize: 13, color: '#a33a3a' }}>This item has since been given to a different contractor.</p>
      )}
      {error && <p style={{ margin: '8px 0 0', fontSize: 13, color: '#e03131' }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" disabled={busy} onClick={() => approve(pending)}>
          {busy ? 'Working…'
            : item.work_order_id ? (multi ? 'Approve — add all to its work order' : 'Approve (already on a work order)')
            : multi ? `Create work order (${shownItems.filter(x => x.status === 'pending' && !x.archived_at).length} items)` : 'Create work order'}
        </button>
        <button className="btn btn-secondary" disabled={busy} onClick={() => decline(pending)}>{multi ? 'Decline all' : 'Decline'}</button>
      </div>
    </div>
  )
}
