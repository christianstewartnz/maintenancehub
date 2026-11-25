import { createClient } from '@/lib/supabase/server'
import { requireUser } from '@/lib/auth'
import { buildWorkOrderEmail } from '@/lib/work-order-email'
import { buildOutlookDraft, attachmentDisposition } from '@/lib/outlook-draft'
import { markWorkOrderSent } from '@/lib/work-order-sent'

/**
 * POST /api/work-orders/[id]/outlook — the same email "Send" would send (PDF attached),
 * returned as an Outlook draft (.eml) for the user to send from their own Outlook. For
 * when the app's email sending is down. Like Notify's Outlook option, generating it
 * counts as sending: the work order is marked sent and locked.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const auth = await requireUser()
  if (auth.error) return auth.error
  const supabase = await createClient()

  const email = await buildWorkOrderEmail(supabase, id)
  if (email.error !== undefined) return Response.json({ error: email.error }, { status: email.status })

  const draft = await buildOutlookDraft({
    to: email.to,
    subject: email.subject,
    html: email.html,
    text: email.text,
    attachments: [email.pdf],
  })

  const { error: markErr } = await markWorkOrderSent(supabase, email.workOrder)
  if (markErr) return Response.json({ error: `Couldn't mark the work order as sent: ${markErr}` }, { status: 500 })

  return new Response(new Uint8Array(draft), {
    headers: {
      'Content-Type': 'message/rfc822',
      'Content-Disposition': attachmentDisposition(`${email.workOrder.work_order_number} - ${email.workOrder.contractor?.company_name?.trim() ?? 'Work order'}.eml`),
      'Cache-Control': 'no-store',
    },
  })
}
