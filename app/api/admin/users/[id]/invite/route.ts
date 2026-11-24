import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { isEmailConfigured } from '@/lib/mailer'
import { bad, isUuid } from '../../../_lib/validate'
import { emailSetPasswordLink, generateSetPasswordLink } from '../../../_lib/invite'

/**
 * POST /api/admin/users/[id]/invite — (re)send a set-password link (admin only).
 * Someone who hasn't accepted yet gets a fresh invite; anyone else a password
 * reset link. Returns the link too, so it can be passed on by hand.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin()
  if (guard.error) return guard.error
  const { id } = await params
  if (!isUuid(id)) return bad('Invalid user')

  const service = createServiceClient()
  const [{ data: profile }, { data: authUser, error: authErr }] = await Promise.all([
    service.from('profiles').select('full_name, is_active').eq('id', id).maybeSingle(),
    service.auth.admin.getUserById(id),
  ])
  if (authErr || !authUser.user?.email) return bad('User not found', 404)
  if (profile && !profile.is_active) return bad('Reactivate this user first.')

  const email = authUser.user.email
  // Supabase refuses a second "invite" for a confirmed user, so they get a recovery link.
  const isNew = !authUser.user.email_confirmed_at && !authUser.user.last_sign_in_at
  const gen = await generateSetPasswordLink(service, req, isNew ? 'invite' : 'recovery', email, profile?.full_name ?? null)
  if ('error' in gen) return bad(gen.error, 502)

  const mail = isEmailConfigured()
    ? await emailSetPasswordLink({ to: email, name: profile?.full_name ?? null, link: gen.link, invitedBy: guard.session.profile.full_name, isNew })
    : { error: 'Email is not set up on the server' }

  return Response.json({ link: gen.link, emailed: !mail.error, emailError: mail.error, to: email })
}
