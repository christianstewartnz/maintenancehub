import { createClient } from '@/lib/supabase/server'
import { Resend } from 'resend'
import { contractorNewItemsEmail } from '@/lib/email-templates'
import { NOT_PENDING_FILTER } from '@/lib/contractor-notify'

interface PendingItem {
  id: string
  item_number: string
  title: string
  unit: { unit_identifier: string | null; address: string | null; project: { name: string } | null } | null
}

/**
 * POST /api/contractors/[id]/notify
 * Body: { mode?: 'email' | 'mark', item_ids?: string[] }
 *
 *  - mode 'email' (default): email the contractor a summary of their pending
 *    items + portal link, then stamp those items as notified.
 *  - mode 'mark': stamp them as notified without sending (e.g. told by phone).
 *
 * `item_ids` limits the action to the items the admin previewed, so an item
 * assigned while the dialog was open isn't silently marked as told.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { mode?: string; item_ids?: unknown }
  const mode = body.mode === 'mark' ? 'mark' : 'email'
  const onlyIds = Array.isArray(body.item_ids) ? body.item_ids.filter((x): x is string => typeof x === 'string') : null

  const { data: contractor } = await supabase
    .from('contractors')
    .select('id, company_name, contact_name, email, portal_token')
    .eq('id', id)
    .single()
  if (!contractor) return Response.json({ error: 'Contractor not found' }, { status: 404 })

  let query = supabase
    .from('maintenance_items')
    .select('id, item_number, title, unit:units(unit_identifier, address, project:projects(name))')
    .eq('contractor_id', id)
    .is('contractor_notified_at', null)
    .not('status', 'in', NOT_PENDING_FILTER)
    .order('created_at')
  if (onlyIds) query = query.in('id', onlyIds)

  const { data: items, error: itemsErr } = await query
  if (itemsErr) return Response.json({ error: itemsErr.message }, { status: 500 })
  if (!items || items.length === 0) {
    return Response.json({ error: 'No new items to notify this contractor about' }, { status: 400 })
  }

  if (mode === 'email') {
    if (!contractor.email) {
      return Response.json({ error: 'Contractor has no email address on file' }, { status: 400 })
    }
    if (!process.env.RESEND_API_KEY) {
      return Response.json({ error: 'Email sending is not configured (missing RESEND_API_KEY)' }, { status: 500 })
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
    const { subject, html } = contractorNewItemsEmail({
      contractorName: contractor.company_name,
      contactName: contractor.contact_name,
      portalUrl: `${appUrl}/portal/${contractor.portal_token}`,
      items: (items as unknown as PendingItem[]).map(i => ({
        itemNumber: i.item_number,
        title: i.title,
        unitIdentifier: i.unit?.unit_identifier ?? null,
        address: i.unit?.address ?? null,
        projectName: i.unit?.project?.name ?? null,
      })),
    })

    const resend = new Resend(process.env.RESEND_API_KEY)
    const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'Maintenance Hub <noreply@maintenancehub.co.nz>'
    const { error: emailError } = await resend.emails.send({ from: fromEmail, to: contractor.email, subject, html })
    if (emailError) return Response.json({ error: emailError.message }, { status: 500 })
  }

  const now = new Date().toISOString()
  const ids = items.map(i => i.id)

  const { error: stampErr } = await supabase
    .from('maintenance_items')
    .update({ contractor_notified_at: now })
    .in('id', ids)
  if (stampErr) {
    // The email (if any) already went out; report so the admin knows the badge may be stale.
    return Response.json({ error: `Notified, but failed to record it: ${stampErr.message}`, sent: mode === 'email' }, { status: 500 })
  }

  await supabase.from('activity_log').insert(ids.map(itemId => ({
    maintenance_item_id: itemId,
    action: 'contractor_notified',
    details: {
      contractor_id: contractor.id,
      contractor: contractor.company_name,
      method: mode === 'email' ? 'email' : 'manual',
      ...(mode === 'email' ? { to: contractor.email } : {}),
    },
    performed_by: user.email ?? 'admin',
  })))

  return Response.json({ success: true, count: ids.length, mode })
}
