import { createClient } from '@supabase/supabase-js'
import { sendEmail, isEmailConfigured } from '@/lib/mailer'
import { contractorCommentEmail } from '@/lib/email-templates'
import { formatUnitLabel } from '@/lib/utils'
import { getItemAlertRecipients } from '@/lib/notify-recipients'
import { refuseIfNotVisible } from '../../_lib/visible'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  const { item_id, author, content } = await req.json()

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )

  const refused = await refuseIfNotVisible(supabase, token, item_id)
  if (refused) return refused

  const { data, error } = await supabase.rpc('portal_add_comment', {
    p_token: token,
    p_item_id: item_id,
    p_author: author,
    p_content: content,
  })

  if (error) return Response.json({ error: error.message }, { status: 400 })
  if (data?.error) return Response.json({ data })

  // Contractor is working on it: Logged/Assigned → In Progress
  const { data: status } = await supabase.rpc('portal_mark_started', { p_token: token, p_item_id: item_id })

  // Send notification email if enabled
  if (isEmailConfigured()) {
    try {
      await sendCommentNotification(token, item_id, author, content)
    } catch {
      // Non-fatal
    }
  }

  return Response.json({ data, status })
}

async function sendCommentNotification(
  _token: string,
  itemId: string,
  author: string,
  commentText: string,
) {
  const serviceSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: item } = await serviceSupabase
    .from('maintenance_items')
    .select('id, item_number, title, unit:units(unit_identifier, address, project:projects(name))')
    .eq('id', itemId)
    .single()

  if (!item) return

  // The item's responsible person (+ admins following all projects), if they have "New contractor comment" on.
  const recipients = await getItemAlertRecipients(serviceSupabase, 'contractor_comment_email', itemId)
  if (!recipients.length) return

  const unit = item.unit as any
  const project = unit?.project as any

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const { subject, html } = contractorCommentEmail({
    itemTitle: item.title,
    itemNumber: item.item_number,
    unitLabel: formatUnitLabel(unit),
    projectName: project?.name ?? '—',
    contractorName: author,
    commentText,
    appUrl,
    itemId: item.id,
  })

  await Promise.all(recipients.map(r => sendEmail({ to: r.email, subject, html })))
}
