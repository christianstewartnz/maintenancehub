import { createClient } from '@/lib/supabase/server'
import { diagnoseSmtp, smtpTestSend } from '@/lib/mailer'

/**
 * GET /api/email/diagnose — signed-in users only.
 * Shows which email settings the server can see (never the password) and
 * whether it can log in to the SMTP server.
 *
 * GET /api/email/diagnose?send=1 — also sends one test email to the signed-in
 * user's own address and returns the full SMTP conversation (credentials hidden).
 */
export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const settings = await diagnoseSmtp()
  const wantsSend = new URL(req.url).searchParams.get('send') === '1'
  if (!wantsSend) return Response.json(settings, { headers: { 'Cache-Control': 'no-store' } })

  if (settings.mode !== 'smtp') return Response.json({ ...settings, testSend: 'skipped: SMTP is not configured' })
  if (!user.email) return Response.json({ ...settings, testSend: 'skipped: your login has no email address' })

  const testSend = await smtpTestSend(user.email)
  return Response.json({ settings, testSend }, { headers: { 'Cache-Control': 'no-store' } })
}
