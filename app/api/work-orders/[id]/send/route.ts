import { createClient } from '@/lib/supabase/server'
import { generateWorkOrderPDF } from '@/lib/generate-pdf'
import { Resend } from 'resend'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const [{ data: workOrder }, { data: items }] = await Promise.all([
    supabase
      .from('work_orders')
      .select('*, project:projects(id, name, address), contractor:contractors(id, company_name, contact_name, email, phone, portal_token)')
      .eq('id', id)
      .single(),
    supabase
      .from('maintenance_items')
      .select('*, unit:units(id, unit_identifier, lot_number, address, owner_name, owner_phone, owner_email, access_contact_name, access_contact_phone), trade:trades(name)')
      .eq('work_order_id', id)
      .order('created_at'),
  ])

  if (!workOrder) return Response.json({ error: 'Work order not found' }, { status: 404 })

  const contractor = workOrder.contractor as any
  const project = workOrder.project as any

  if (!contractor?.email) {
    return Response.json({ error: 'Contractor has no email address on file' }, { status: 400 })
  }

  if (!process.env.RESEND_API_KEY) {
    return Response.json({ error: 'Email sending is not configured (missing RESEND_API_KEY)' }, { status: 500 })
  }

  // Generate PDF
  const pdfBuffer = await generateWorkOrderPDF(workOrder, items ?? [])

  // Build units summary for the email body
  const unitMap = new Map<string, { unit: any; items: any[] }>()
  for (const item of (items ?? [])) {
    const unitId = item.unit?.id ?? 'unknown'
    if (!unitMap.has(unitId)) unitMap.set(unitId, { unit: item.unit, items: [] })
    unitMap.get(unitId)!.items.push(item)
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const portalUrl = `${appUrl}/portal/${contractor.portal_token}`
  const itemCount = items?.length ?? 0

  let html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 600px; color: #37352f;">
      <h2 style="margin-bottom: 4px;">Work Order ${workOrder.work_order_number}</h2>
      <p style="color: #787774; margin-top: 0;">${project?.name ?? ''}</p>
      <hr style="border: none; border-top: 1px solid #e9e9e7; margin: 20px 0;" />
      <p>Hi ${contractor.company_name},</p>
      <p>Please find attached work order <strong>${workOrder.work_order_number}</strong> covering
      <strong>${itemCount} item${itemCount !== 1 ? 's' : ''}</strong> across
      <strong>${unitMap.size} unit${unitMap.size !== 1 ? 's' : ''}</strong>.</p>
      <h3 style="margin-bottom: 8px;">Units &amp; Site Access</h3>
      <table style="width:100%; border-collapse:collapse; font-size:14px;">
  `

  for (const [, { unit, items: unitItems }] of unitMap) {
    html += `
      <tr style="border-top: 1px solid #e9e9e7;">
        <td style="padding: 10px 0; vertical-align: top; width: 50%;">
          <strong>${unit?.unit_identifier ?? '—'}</strong>
          ${unit?.address ? `<br><span style="color:#787774">${unit.address}</span>` : ''}
        </td>
        <td style="padding: 10px 0; vertical-align: top; color: #787774; font-size: 13px;">
          ${unit?.owner_name ? `Owner: ${unit.owner_name}${unit.owner_phone ? ` · ${unit.owner_phone}` : ''}<br>` : ''}
          ${unit?.access_contact_name ? `Access: ${unit.access_contact_name}${unit.access_contact_phone ? ` · ${unit.access_contact_phone}` : ''}` : ''}
        </td>
        <td style="padding: 10px 0; vertical-align: top; text-align: right; color: #787774; font-size: 13px;">
          ${unitItems.length} item${unitItems.length !== 1 ? 's' : ''}
        </td>
      </tr>
    `
  }

  html += `</table>`

  if (workOrder.notes) {
    html += `
      <h3 style="margin-top: 24px; margin-bottom: 8px;">Notes</h3>
      <p style="background:#f7f7f5; padding: 12px 16px; border-radius: 6px; white-space: pre-wrap;">${workOrder.notes}</p>
    `
  }

  html += `
      <hr style="border: none; border-top: 1px solid #e9e9e7; margin: 24px 0;" />
      <p>View all your jobs online:<br>
        <a href="${portalUrl}" style="color: #2383e2;">${portalUrl}</a>
      </p>
      <p style="color: #787774; font-size: 13px;">The full work order PDF is attached to this email.</p>
    </div>
  `

  const resend = new Resend(process.env.RESEND_API_KEY)
  const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'Maintenance Hub <noreply@maintenancehub.co.nz>'

  const { error: emailError } = await resend.emails.send({
    from: fromEmail,
    to: contractor.email,
    subject: `Work Order ${workOrder.work_order_number} — ${project?.name ?? ''}`,
    html,
    attachments: [
      {
        filename: `${workOrder.work_order_number}.pdf`,
        content: pdfBuffer,
      },
    ],
  })

  if (emailError) {
    return Response.json({ error: emailError.message }, { status: 500 })
  }

  await supabase
    .from('work_orders')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', id)

  return Response.json({ success: true })
}
