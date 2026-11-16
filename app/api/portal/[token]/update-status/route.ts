import { createClient } from '@supabase/supabase-js'
import { sendEmail, isEmailConfigured } from '@/lib/mailer'
import { contractorCompleteEmail } from '@/lib/email-templates'
import { formatUnitLabel } from '@/lib/utils'
import { getRecipients } from '@/lib/notify-recipients'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  const { item_id, status } = await req.json()

  // Use anon client (portal_update_status is SECURITY DEFINER, safe for anon)
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )

  const { data, error } = await supabase.rpc('portal_update_status', {
    p_token: token,
    p_item_id: item_id,
    p_status: status,
  })

  if (error) return Response.json({ error: error.message }, { status: 400 })

  // Send notification email when contractor marks as complete
  if (status === 'contractor_complete' && isEmailConfigured()) {
    try {
      await sendContractorCompleteNotification(token, item_id)
    } catch {
      // Non-fatal: status was already updated
    }
  }

  return Response.json({ data })
}

async function sendContractorCompleteNotification(token: string, itemId: string) {
  const serviceSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: item } = await serviceSupabase
    .from('maintenance_items')
    .select('id, item_number, title, unit:units(unit_identifier, address, project:projects(id, name)), contractor:contractors(company_name)')
    .eq('id', itemId)
    .single()

  if (!item) return

  // Every user who has "Work ready for inspection" switched on.
  const recipients = await getRecipients(serviceSupabase, 'contractor_complete_email')
  if (!recipients.length) return

  const unit = item.unit as any
  const contractor = item.contractor as any
  const project = unit?.project as any

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const { subject, html } = contractorCompleteEmail({
    itemTitle: item.title,
    itemNumber: item.item_number,
    unitLabel: formatUnitLabel(unit),
    projectName: project?.name ?? '—',
    contractorName: contractor?.company_name ?? 'Contractor',
    appUrl,
    itemId: item.id,
  })

  await Promise.all(recipients.map(r => sendEmail({ to: r.email, subject, html })))
}
