import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { contractorCommentEmail } from '@/lib/email-templates'

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

  const { data, error } = await supabase.rpc('portal_add_comment', {
    p_token: token,
    p_item_id: item_id,
    p_author: author,
    p_content: content,
  })

  if (error) return Response.json({ error: error.message }, { status: 400 })

  // Send notification email if enabled
  if (process.env.RESEND_API_KEY) {
    try {
      await sendCommentNotification(token, item_id, author, content)
    } catch {
      // Non-fatal
    }
  }

  return Response.json({ data })
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
    .select('id, item_number, title, unit:units(unit_identifier, project:projects(name))')
    .eq('id', itemId)
    .single()

  if (!item) return

  const { data: prefs } = await serviceSupabase
    .from('notification_preferences')
    .select('contractor_comment_email, user_id')
    .eq('contractor_comment_email', true)
    .limit(1)
    .single()

  if (!prefs) return

  const { data: { user } } = await serviceSupabase.auth.admin.getUserById(prefs.user_id)
  if (!user?.email) return

  const unit = item.unit as any
  const project = unit?.project as any

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const { subject, html } = contractorCommentEmail({
    itemTitle: item.title,
    itemNumber: item.item_number,
    unitIdentifier: unit?.unit_identifier ?? '—',
    projectName: project?.name ?? '—',
    contractorName: author,
    commentText,
    appUrl,
    itemId: item.id,
  })

  const resend = new Resend(process.env.RESEND_API_KEY)
  const from = process.env.RESEND_FROM_EMAIL ?? 'Maintenance Hub <noreply@maintenancehub.co.nz>'
  await resend.emails.send({ from, to: user.email, subject, html })
}
