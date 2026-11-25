import { createClient } from '@/lib/supabase/server'
import { sendEmail, isEmailConfigured } from '@/lib/mailer'
import { requireUser } from '@/lib/auth'
import { buildWorkOrderEmail } from '@/lib/work-order-email'
import { markWorkOrderSent } from '@/lib/work-order-sent'

/**
 * POST /api/work-orders/[id]/send — emails the work order (PDF attached) to the
 * contractor's main address and every extra contact, then marks it sent (locked).
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const auth = await requireUser()
  if (auth.error) return auth.error
  const { user } = auth.session
  // The user's own client: RLS hides work orders on projects they aren't on (→ 404)
  const supabase = await createClient()

  if (!isEmailConfigured()) {
    return Response.json({ error: 'Email sending is not configured (set SMTP_HOST on the server)' }, { status: 500 })
  }

  const email = await buildWorkOrderEmail(supabase, id)
  if (email.error !== undefined) return Response.json({ error: email.error }, { status: email.status })

  const cc = user.email && !email.to.some(e => e.toLowerCase() === user.email!.toLowerCase()) ? user.email : null
  const { error: emailError } = await sendEmail({
    replyTo: user.email,
    to: email.to.join(', '),
    cc,
    subject: email.subject,
    html: email.html,
    text: email.text,
    attachments: [email.pdf],
  })
  if (emailError) return Response.json({ error: emailError }, { status: 500 })

  const { error: markErr } = await markWorkOrderSent(supabase, email.workOrder)
  if (markErr) return Response.json({ error: `Sent, but failed to record it: ${markErr}` }, { status: 500 })

  return Response.json({ success: true, to: email.to })
}
