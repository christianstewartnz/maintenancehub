import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth'
import { sendEmail, senderAddress, SENDER_NAME } from '@/lib/mailer'
import { recipientEmail } from '@/lib/notify-recipients'

/**
 * POST /api/email/test — sends a test email through the SMTP server to the
 * signed-in user's notification address (their saved override, else login email).
 * Admins only: it's an email-setup tool.
 */
export async function POST() {
  const guard = await requireAdmin()
  if (guard.error) return guard.error
  const { user } = guard.session
  const supabase = await createClient()

  const { data: prefs } = await supabase
    .from('notification_preferences')
    .select('notify_email')
    .eq('user_id', user.id)
    .maybeSingle()

  const to = recipientEmail(prefs, user.email)
  if (!to) return Response.json({ error: 'No email address to send to' }, { status: 400 })

  const { error } = await sendEmail({
    to,
    subject: `${SENDER_NAME}: test notification`,
    html: `<p>This is a test notification from ${SENDER_NAME}.</p>
<p>Your notification emails will be delivered to <strong>${to}</strong>, sent from <strong>${senderAddress() ?? 'the SMTP server'}</strong>.</p>`,
    text: `This is a test notification from ${SENDER_NAME}. Notifications will be delivered to ${to}.`,
  })

  if (error) return Response.json({ error }, { status: 502 })
  return Response.json({ sent: true, to })
}
