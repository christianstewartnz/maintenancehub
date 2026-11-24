import { requireAdmin } from '@/lib/auth'
import { diagnoseSmtp, smtpTestSend } from '@/lib/mailer'

/**
 * GET /api/email/diagnose — admins only (it reveals server mail settings).
 * Shows which email settings the server can see (never the password) and
 * whether it can log in to the SMTP server.
 *
 * GET /api/email/diagnose?send=1 — also sends one test email to the signed-in
 * user's own address and returns the full SMTP conversation (credentials hidden).
 */
export async function GET(req: Request) {
  const guard = await requireAdmin()
  if (guard.error) return guard.error
  const { user } = guard.session

  const settings = await diagnoseSmtp()
  const wantsSend = new URL(req.url).searchParams.get('send') === '1'
  if (!wantsSend) return Response.json(settings, { headers: { 'Cache-Control': 'no-store' } })

  if (settings.mode !== 'smtp') return Response.json({ ...settings, testSend: 'skipped: SMTP is not configured' })
  if (!user.email) return Response.json({ ...settings, testSend: 'skipped: your login has no email address' })

  const testSend = await smtpTestSend(user.email)
  return Response.json({ settings, testSend }, { headers: { 'Cache-Control': 'no-store' } })
}
