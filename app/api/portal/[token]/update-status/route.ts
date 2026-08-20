import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { contractorCompleteEmail } from '@/lib/email-templates'

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
  if (status === 'contractor_complete' && process.env.RESEND_API_KEY) {
    try {
      await sendContractorCompleteNotification(token, item_id)
    } catch {
      // Non-fatal: status was already updated
    }
  }

  return Response.json({ data })
}

async function sendContractorCompleteNotification(token: string, itemId: string) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )

  // Get item details via portal context
  const { data: item } = await supabase
    .from('maintenance_items')
    .select('id, item_number, title, unit:units(unit_identifier, project:projects(id, name)), contractor:contractors(company_name)')
    .eq('id', itemId)
    .single()

  if (!item) return

  // Get admin notification prefs (use service role to access auth)
  const serviceSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: prefs } = await serviceSupabase
    .from('notification_preferences')
    .select('contractor_complete_email, user_id')
    .eq('contractor_complete_email', true)
    .limit(1)
    .single()

  if (!prefs) return

  const { data: { user } } = await serviceSupabase.auth.admin.getUserById(prefs.user_id)
  if (!user?.email) return

  const unit = item.unit as any
  const contractor = item.contractor as any
  const project = unit?.project as any

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const { subject, html } = contractorCompleteEmail({
    itemTitle: item.title,
    itemNumber: item.item_number,
    unitIdentifier: unit?.unit_identifier ?? '—',
    projectName: project?.name ?? '—',
    contractorName: contractor?.company_name ?? 'Contractor',
    appUrl,
    itemId: item.id,
  })

  const resend = new Resend(process.env.RESEND_API_KEY)
  const from = process.env.RESEND_FROM_EMAIL ?? 'Maintenance Hub <noreply@maintenancehub.co.nz>'
  await resend.emails.send({ from, to: user.email, subject, html })
}
