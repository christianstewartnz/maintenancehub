import { createClient } from '@/lib/supabase/server'
import { diagnoseSmtp } from '@/lib/mailer'

/**
 * GET /api/email/diagnose — signed-in users only.
 * Shows which email settings the server can see (never the password) and
 * whether it can log in to the SMTP server. Sends no email.
 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  return Response.json(await diagnoseSmtp(), { headers: { 'Cache-Control': 'no-store' } })
}
