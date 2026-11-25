'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Receipt } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatDateTime } from '@/lib/utils'
import type { WorkOrderRequest } from '@/lib/types'
import { COUNTS_CHANGED_EVENT } from '@/lib/contractor-notify'

interface Props {
  item: { id: string; contractor_id: string | null; work_order_id: string | null; unit: any }
  requests: WorkOrderRequest[]
  currentUserId: string
  /** Name to record in the activity log. */
  actorName: string
}

const money = (n: number) => `$${Number(n).toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * Contractor work order requests on this item (from the portal): the pending one with
 * Create work order / Decline, and the latest answered one for context.
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

  async function answer(r: WorkOrderRequest, status: 'approved' | 'declined', note: string | null, workOrderId: string | null) {
    const { error } = await supabase
      .from('work_order_requests')
      .update({ status, response_note: note, responded_by: currentUserId || null, responded_at: new Date().toISOString(), work_order_id: workOrderId })
      .eq('id', r.id)
      .eq('status', 'pending')
    if (error) throw error
    await supabase.from('activity_log').insert({
      maintenance_item_id: item.id,
      action: status === 'approved' ? 'work_order_request_approved' : 'work_order_request_declined',
      details: { contractor: r.contractor?.company_name ?? null, note },
      performed_by: actorName,
    })
    // Sidebar Work Orders badge
    window.dispatchEvent(new Event(COUNTS_CHANGED_EVENT))
  }

  async function approve(r: WorkOrderRequest) {
    setBusy(true)
    setError('')
    try {
      let woId = item.work_order_id
      if (!woId) {
        const projectId = item.unit?.project?.id
        if (!projectId) throw new Error('This item has no project.')
        const { data: wo, error: woErr } = await supabase
          .from('work_orders')
          .insert({ project_id: projectId, contractor_id: r.contractor_id, status: 'draft', notes: null })
          .select('id')
          .single()
        if (woErr || !wo) throw woErr ?? new Error('Could not create the work order.')
        const { error: linkErr } = await supabase.from('maintenance_items').update({ work_order_id: wo.id }).eq('id', item.id)
        if (linkErr) throw linkErr
        woId = wo.id
      }
      await answer(r, 'approved', null, woId)
      router.push(`/work-orders/${woId}`)
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong.')
      setBusy(false)
    }
  }

  async function decline(r: WorkOrderRequest) {
    const note = window.prompt(`Decline ${r.contractor?.company_name ?? 'the contractor'}'s work order request?\n\nOptional note for the contractor (shown on their portal):`, '')
    if (note === null) return
    setBusy(true)
    setError('')
    try {
      await answer(r, 'declined', note.trim() || null, null)
      router.refresh()
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong.')
    }
    setBusy(false)
  }

  if (!pending) {
    const approved = shown.status === 'approved'
    return (
      <div style={{ background: '#f7f7f5', border: '1px solid #e9e9e7', borderRadius: 8, padding: '10px 14px', marginBottom: 24, fontSize: 13, color: '#787774', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <Receipt size={13} />
        {contractorName} requested a work order {formatDateTime(shown.created_at)} —{' '}
        <strong style={{ color: approved ? '#2e7d32' : '#a33a3a' }}>{approved ? 'approved' : 'declined'}</strong>
        {shown.responded_at && ` ${formatDateTime(shown.responded_at)}`}
        {!approved && shown.response_note && <span>(“{shown.response_note}”)</span>}
        {approved && shown.work_order && (
          <Link href={`/work-orders/${shown.work_order.id}`} style={{ color: '#2383e2', textDecoration: 'none' }}>{shown.work_order.work_order_number}</Link>
        )}
      </div>
    )
  }

  const otherContractor = item.contractor_id && pending.contractor_id !== item.contractor_id
  return (
    <div style={{ background: '#fff8e6', border: '1px solid #f3e2b8', borderRadius: 8, padding: '14px 16px', marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 600, color: '#8a5a00' }}>
        <Receipt size={15} /> Work order requested by {contractorName}
        <span style={{ fontWeight: 400, fontSize: 12, color: '#a07a2a', marginLeft: 'auto' }}>{formatDateTime(pending.created_at)}</span>
      </div>
      <blockquote style={{ margin: '10px 0 0', padding: '8px 12px', background: 'white', borderLeft: '3px solid #f3e2b8', borderRadius: '0 6px 6px 0', fontSize: 14, color: '#37352f', whiteSpace: 'pre-wrap' }}>
        {pending.reason}
      </blockquote>
      {pending.estimated_cost != null && (
        <p style={{ margin: '8px 0 0', fontSize: 13, color: '#37352f' }}><strong>Estimate:</strong> {money(pending.estimated_cost)} + GST</p>
      )}
      {otherContractor && (
        <p style={{ margin: '8px 0 0', fontSize: 13, color: '#a33a3a' }}>This item has since been given to a different contractor.</p>
      )}
      {error && <p style={{ margin: '8px 0 0', fontSize: 13, color: '#e03131' }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" disabled={busy} onClick={() => approve(pending)}>
          {busy ? 'Working…' : item.work_order_id ? 'Approve (already on a work order)' : 'Create work order'}
        </button>
        <button className="btn btn-secondary" disabled={busy} onClick={() => decline(pending)}>Decline</button>
      </div>
    </div>
  )
}
