import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { sendEmail, isEmailConfigured } from '@/lib/mailer'
import { workOrderRequestEmail } from '@/lib/email-templates'
import { formatUnitLabel } from '@/lib/utils'
import { getItemAlertRecipients } from '@/lib/notify-recipients'
import { refuseIfNotVisible } from '../../_lib/visible'

const MAX_REASON = 2000
const MAX_ITEMS = 50

/**
 * A contractor requests one work order for one or more of their portal items.
 * All items must be on the same unit.
 * Body: { item_ids: string[], reason, estimated_cost?, estimated_hours? }  (or the older { item_id, … })
 *
 * Each item gets its own work_order_requests row; rows sent together share a group_id
 * so staff answer them as one request.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const body = await req.json().catch(() => ({}))
  const rawIds: unknown[] = Array.isArray(body?.item_ids) ? body.item_ids : body?.item_id ? [body.item_id] : []
  const itemIds = Array.from(new Set(rawIds.filter((v): v is string => typeof v === 'string' && !!v)))
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''
  const rawCost = body?.estimated_cost
  const estimatedCost = rawCost === null || rawCost === undefined || rawCost === '' ? null : Number(rawCost)
  const rawHours = body?.estimated_hours
  const estimatedHours = rawHours === null || rawHours === undefined || rawHours === '' ? null : Number(rawHours)

  if (!itemIds.length) return NextResponse.json({ error: 'Choose at least one item.' }, { status: 400 })
  if (itemIds.length > MAX_ITEMS) return NextResponse.json({ error: 'Too many items in one request.' }, { status: 400 })
  if (!reason) return NextResponse.json({ error: 'Please give a reason for the request.' }, { status: 400 })
  if (reason.length > MAX_REASON) return NextResponse.json({ error: 'Reason is too long.' }, { status: 400 })
  if (estimatedCost !== null && (!Number.isFinite(estimatedCost) || estimatedCost < 0 || estimatedCost > 10_000_000)) {
    return NextResponse.json({ error: 'Estimated cost must be a positive number.' }, { status: 400 })
  }
  if (estimatedHours !== null && (!Number.isFinite(estimatedHours) || estimatedHours < 0 || estimatedHours > 100_000)) {
    return NextResponse.json({ error: 'Estimated hours must be a positive number.' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Only items shown on their portal (released, open, not hidden).
  for (const id of itemIds) {
    const refused = await refuseIfNotVisible(supabase, token, id)
    if (refused) return refused
  }

  const { data: contractor } = await supabase
    .from('contractors')
    .select('id, company_name')
    .eq('portal_token', token)
    .single()
  if (!contractor) return NextResponse.json({ error: 'Invalid token' }, { status: 401 })

  const { data: items } = await supabase
    .from('maintenance_items')
    .select('id, item_number, title, contractor_id, work_order_id, unit_id, unit:units(unit_identifier, address, project:projects(name))')
    .in('id', itemIds)
    .order('item_number')
  if (!items || items.length !== itemIds.length || items.some(i => i.contractor_id !== contractor.id)) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 403 })
  }
  if (new Set(items.map(i => i.unit_id)).size > 1) {
    return NextResponse.json({ error: 'A work order request can only include items from one unit.' }, { status: 400 })
  }
  const onWo = items.filter(i => i.work_order_id)
  if (onWo.length) {
    return NextResponse.json({ error: `${onWo.map(i => i.item_number).join(', ')} ${onWo.length === 1 ? 'is' : 'are'} already on a work order.` }, { status: 409 })
  }

  const cost = estimatedCost === null ? null : Math.round(estimatedCost * 100) / 100
  const hours = estimatedHours === null ? null : Math.round(estimatedHours * 100) / 100
  // Single-item requests keep group_id null, like the ones made before grouping existed.
  const groupId = items.length > 1 ? randomUUID() : null

  // One statement, so either every item gets a request or none do.
  const { data: requests, error } = await supabase
    .from('work_order_requests')
    .insert(items.map(i => ({
      maintenance_item_id: i.id,
      contractor_id: contractor.id,
      reason,
      estimated_cost: cost,
      estimated_hours: hours,
      group_id: groupId,
    })))
    .select('id, maintenance_item_id, group_id, status, reason, estimated_cost, estimated_hours, response_note, created_at, responded_at')

  if (error || !requests) {
    // work_order_requests_one_pending
    if (error?.code === '23505') {
      return NextResponse.json({ error: items.length === 1
        ? 'You have already requested a work order for this item.'
        : 'You have already requested a work order for one of these items.' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Could not send the request. Please try again.' }, { status: 500 })
  }

  const otherNumbers = (id: string) => items.filter(i => i.id !== id).map(i => i.item_number)
  await supabase.from('activity_log').insert(items.map(i => ({
    maintenance_item_id: i.id,
    action: 'work_order_requested',
    details: {
      contractor: contractor.company_name,
      estimated_cost: cost,
      estimated_hours: hours,
      ...(items.length > 1 ? { with_items: otherNumbers(i.id) } : {}),
    },
    performed_by: contractor.company_name,
  })))

  if (isEmailConfigured()) {
    try {
      // Same people who get "new contractor comment" alerts, for any of the items (deduped).
      const lists = await Promise.all(items.map(i => getItemAlertRecipients(supabase, 'contractor_comment_email', i.id)))
      const recipients = Array.from(new Map(lists.flat().map(r => [r.email.toLowerCase(), r])).values())
      if (recipients.length) {
        const unit = items[0].unit as any
        const { subject, html } = workOrderRequestEmail({
          items: items.map(i => ({ itemNumber: i.item_number, itemTitle: i.title })),
          unitLabel: formatUnitLabel(unit),
          projectName: unit?.project?.name ?? '—',
          contractorName: contractor.company_name,
          reason,
          estimatedCost: cost,
          estimatedHours: hours,
          appUrl: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
          itemId: items[0].id,
        })
        await Promise.all(recipients.map(r => sendEmail({ to: r.email, subject, html })))
      }
    } catch {
      // Non-fatal: the request is saved and shows in the app
    }
  }

  // data: one request row per item
  return NextResponse.json({ data: requests, group_id: groupId })
}
