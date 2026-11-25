import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { sendEmail, isEmailConfigured } from '@/lib/mailer'
import { workOrderRequestEmail } from '@/lib/email-templates'
import { formatUnitLabel } from '@/lib/utils'
import { getItemAlertRecipients } from '@/lib/notify-recipients'
import { refuseIfNotVisible } from '../../_lib/visible'

const MAX_REASON = 2000

/**
 * A contractor requests a work order on one of their portal items.
 * Body: { item_id, reason, estimated_cost? }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const body = await req.json().catch(() => ({}))
  const itemId = body?.item_id
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''
  const rawCost = body?.estimated_cost
  const estimatedCost = rawCost === null || rawCost === undefined || rawCost === '' ? null : Number(rawCost)

  if (!reason) return NextResponse.json({ error: 'Please give a reason for the request.' }, { status: 400 })
  if (reason.length > MAX_REASON) return NextResponse.json({ error: 'Reason is too long.' }, { status: 400 })
  if (estimatedCost !== null && (!Number.isFinite(estimatedCost) || estimatedCost < 0 || estimatedCost > 10_000_000)) {
    return NextResponse.json({ error: 'Estimated cost must be a positive number.' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Only items shown on their portal (released, open, not hidden).
  const refused = await refuseIfNotVisible(supabase, token, itemId)
  if (refused) return refused

  const { data: contractor } = await supabase
    .from('contractors')
    .select('id, company_name')
    .eq('portal_token', token)
    .single()
  if (!contractor) return NextResponse.json({ error: 'Invalid token' }, { status: 401 })

  const { data: item } = await supabase
    .from('maintenance_items')
    .select('id, item_number, title, contractor_id, work_order_id, unit:units(unit_identifier, address, project:projects(name))')
    .eq('id', itemId)
    .single()
  if (!item || item.contractor_id !== contractor.id) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 403 })
  }
  if (item.work_order_id) {
    return NextResponse.json({ error: 'This item is already on a work order.' }, { status: 409 })
  }

  const { data: request, error } = await supabase
    .from('work_order_requests')
    .insert({
      maintenance_item_id: item.id,
      contractor_id: contractor.id,
      reason,
      estimated_cost: estimatedCost === null ? null : Math.round(estimatedCost * 100) / 100,
    })
    .select('id, status, reason, estimated_cost, response_note, created_at, responded_at')
    .single()

  if (error) {
    // work_order_requests_one_pending
    if (error.code === '23505') return NextResponse.json({ error: 'You have already requested a work order for this item.' }, { status: 409 })
    return NextResponse.json({ error: 'Could not send the request. Please try again.' }, { status: 500 })
  }

  await supabase.from('activity_log').insert({
    maintenance_item_id: item.id,
    action: 'work_order_requested',
    details: { contractor: contractor.company_name, estimated_cost: request.estimated_cost },
    performed_by: contractor.company_name,
  })

  if (isEmailConfigured()) {
    try {
      // Same people who get "new contractor comment" alerts for this item.
      const recipients = await getItemAlertRecipients(supabase, 'contractor_comment_email', item.id)
      if (recipients.length) {
        const unit = item.unit as any
        const { subject, html } = workOrderRequestEmail({
          itemTitle: item.title,
          itemNumber: item.item_number,
          unitLabel: formatUnitLabel(unit),
          projectName: unit?.project?.name ?? '—',
          contractorName: contractor.company_name,
          reason,
          estimatedCost: request.estimated_cost,
          appUrl: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
          itemId: item.id,
        })
        await Promise.all(recipients.map(r => sendEmail({ to: r.email, subject, html })))
      }
    } catch {
      // Non-fatal: the request is saved and shows in the app
    }
  }

  return NextResponse.json({ data: request })
}
