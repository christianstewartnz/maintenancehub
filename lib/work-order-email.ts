import type { createClient } from '@/lib/supabase/server'
import { generateWorkOrderPDF } from '@/lib/generate-pdf'
import { contractorRecipients } from '@/lib/contractor-recipients'

type Client = Awaited<ReturnType<typeof createClient>>

const WORK_ORDER_SELECT =
  '*, project:projects(id, name, address), contractor:contractors(id, company_name, contact_name, email, phone, portal_token)'
const ITEMS_SELECT =
  '*, unit:units(id, unit_identifier, lot_number, address, access_contact_name, access_contact_phone, owners:unit_owners(id, name, phone)), trade:trades(name)'

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

export type WorkOrderEmail =
  | { error: string; status: number }
  | {
      error?: undefined
      workOrder: any
      to: string[]
      subject: string
      html: string
      text: string
      pdf: { filename: string; content: Buffer; contentType: string }
    }

/**
 * Loads a work order (with the user's own client, so RLS applies) and builds the email
 * that sends it: one email to the contractor's main address and every extra contact,
 * with the work order PDF attached. Used by both "Send" (SMTP) and the Outlook draft.
 */
export async function buildWorkOrderEmail(supabase: Client, id: string): Promise<WorkOrderEmail> {
  const [{ data: workOrder }, { data: items }] = await Promise.all([
    supabase.from('work_orders').select(WORK_ORDER_SELECT).eq('id', id).single(),
    supabase.from('maintenance_items').select(ITEMS_SELECT).eq('work_order_id', id).order('created_at'),
  ])

  if (!workOrder) return { error: 'Work order not found', status: 404 }
  if (workOrder.archived_at) return { error: 'This work order is archived. Restore it first.', status: 400 }
  if (!items?.length) return { error: 'This work order has no items.', status: 400 }

  const contractor = workOrder.contractor as any
  const project = workOrder.project as any
  if (!contractor) return { error: 'Work order has no contractor', status: 400 }

  const { emails, greeting } = await contractorRecipients(supabase, contractor)
  if (emails.length === 0) return { error: 'Contractor has no email address on file', status: 400 }

  const pdfBuffer = await generateWorkOrderPDF(workOrder, items)

  // Units summary for the email body
  const unitMap = new Map<string, { unit: any; items: any[] }>()
  for (const item of items) {
    const unitId = item.unit?.id ?? 'unknown'
    if (!unitMap.has(unitId)) unitMap.set(unitId, { unit: item.unit, items: [] })
    unitMap.get(unitId)!.items.push(item)
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const portalUrl = `${appUrl}/portal/${contractor.portal_token}`
  const itemCount = items.length
  const s = (n: number) => (n !== 1 ? 's' : '')
  const hi = greeting ?? contractor.company_name

  let html = `
    <div style="font-family: -apple-system, 'Segoe UI', sans-serif; max-width: 600px; color: #37352f;">
      <h2 style="margin-bottom: 4px;">Work Order ${esc(workOrder.work_order_number)}</h2>
      <p style="color: #787774; margin-top: 0;">${esc(project?.name)}</p>
      <hr style="border: none; border-top: 1px solid #e9e9e7; margin: 20px 0;" />
      <p>Hi ${esc(hi)},</p>
      <p>Please find attached work order <strong>${esc(workOrder.work_order_number)}</strong> covering
      <strong>${itemCount} item${s(itemCount)}</strong> across
      <strong>${unitMap.size} unit${s(unitMap.size)}</strong>.</p>
      <h3 style="margin-bottom: 8px;">Units &amp; Site Access</h3>
      <table style="width:100%; border-collapse:collapse; font-size:14px;">
  `
  const textLines = [
    `Hi ${hi},`,
    '',
    `Please find attached work order ${workOrder.work_order_number} (${project?.name ?? ''}) covering ${itemCount} item${s(itemCount)} across ${unitMap.size} unit${s(unitMap.size)}.`,
    '',
  ]

  for (const [, { unit, items: unitItems }] of unitMap) {
    const owners = (unit?.owners ?? []) as any[]
    html += `
      <tr style="border-top: 1px solid #e9e9e7;">
        <td style="padding: 10px 0; vertical-align: top; width: 50%;">
          <strong>${esc(unit?.unit_identifier || unit?.address || '—')}</strong>
          ${unit?.unit_identifier && unit?.address ? `<br><span style="color:#787774">${esc(unit.address)}</span>` : ''}
        </td>
        <td style="padding: 10px 0; vertical-align: top; color: #787774; font-size: 13px;">
          ${owners.length ? owners.map(o => `Owner: ${esc(o.name)}${o.phone ? ` · ${esc(o.phone)}` : ''}`).join('<br>') + '<br>' : ''}
          ${unit?.access_contact_name ? `Access: ${esc(unit.access_contact_name)}${unit.access_contact_phone ? ` · ${esc(unit.access_contact_phone)}` : ''}` : ''}
        </td>
        <td style="padding: 10px 0; vertical-align: top; text-align: right; color: #787774; font-size: 13px;">
          ${unitItems.length} item${s(unitItems.length)}
        </td>
      </tr>
    `
    textLines.push(`${unit?.unit_identifier || unit?.address || '—'}${unit?.unit_identifier && unit?.address ? ` (${unit.address})` : ''} — ${unitItems.length} item${s(unitItems.length)}`)
    for (const o of owners) textLines.push(`  Owner: ${o.name}${o.phone ? ` · ${o.phone}` : ''}`)
    if (unit?.access_contact_name) textLines.push(`  Access: ${unit.access_contact_name}${unit.access_contact_phone ? ` · ${unit.access_contact_phone}` : ''}`)
  }

  html += `</table>`

  if (workOrder.notes) {
    html += `
      <h3 style="margin-top: 24px; margin-bottom: 8px;">Notes</h3>
      <p style="background:#f7f7f5; padding: 12px 16px; border-radius: 6px; white-space: pre-wrap;">${esc(workOrder.notes)}</p>
    `
    textLines.push('', 'Notes:', workOrder.notes)
  }

  html += `
      <hr style="border: none; border-top: 1px solid #e9e9e7; margin: 24px 0;" />
      <p>View all your jobs online:<br>
        <a href="${esc(portalUrl)}" style="color: #2383e2;">${esc(portalUrl)}</a>
      </p>
      <p style="color: #787774; font-size: 13px;">The full work order PDF is attached to this email.</p>
    </div>
  `
  textLines.push('', `View all your jobs online: ${portalUrl}`, '', 'The full work order PDF is attached to this email.')

  return {
    workOrder,
    to: emails,
    subject: `Work Order ${workOrder.work_order_number} — ${project?.name ?? ''}`,
    html,
    text: textLines.join('\n'),
    pdf: { filename: `${workOrder.work_order_number}.pdf`, content: pdfBuffer, contentType: 'application/pdf' },
  }
}
