import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { isEmailConfigured } from '@/lib/mailer'
import { bad, cleanEmail, cleanName, cleanPhone, isRole, isUuid, readJson } from '../_lib/validate'
import { emailSetPasswordLink, generateSetPasswordLink } from '../_lib/invite'

/**
 * POST /api/admin/users — invite a new user (admin only).
 * Body: { email, full_name?, phone?, role: 'admin'|'staff', project_ids?: string[] }
 * Creates the auth user + profile, assigns their projects and emails them a
 * set-password link. The link is also returned so the admin can pass it on by
 * hand if email isn't set up or didn't arrive.
 */
export async function POST(req: Request) {
  const guard = await requireAdmin()
  if (guard.error) return guard.error

  const body = await readJson(req)
  if (!body) return bad('Invalid request')

  const email = cleanEmail(body.email)
  if (!email) return bad('Enter a valid email address')
  const fullName = cleanName(body.full_name)
  if (fullName instanceof Error) return bad(fullName.message)
  const phone = cleanPhone(body.phone)
  if (phone instanceof Error) return bad(phone.message)
  const role = body.role ?? 'staff'
  if (!isRole(role)) return bad('Role must be admin or staff')
  const projectIds = body.project_ids ?? []
  if (!Array.isArray(projectIds) || !projectIds.every(isUuid)) return bad('Invalid projects')

  const service = createServiceClient()

  const { data: existing } = await service.from('profiles').select('id').ilike('email', email).maybeSingle()
  if (existing) return bad('There is already a user with that email. Use "Send set-password link" on their row instead.', 409)

  if (projectIds.length) {
    const { data: found } = await service.from('projects').select('id').in('id', projectIds)
    if ((found ?? []).length !== new Set(projectIds).size) return bad('One or more projects no longer exist')
  }

  const gen = await generateSetPasswordLink(service, req, 'invite', email, fullName ?? null)
  if ('error' in gen) return bad(gen.error, 502)
  const userId = gen.user.id

  // The auth trigger creates the profile as 'staff' with the name from metadata; set the rest.
  const { error: profErr } = await service
    .from('profiles')
    .upsert({ id: userId, email, full_name: fullName ?? null, phone: phone ?? null, role, is_active: true, updated_at: new Date().toISOString() }, { onConflict: 'id' })
  if (profErr) return bad(`User created, but saving their profile failed: ${profErr.message}`, 500)

  if (projectIds.length) {
    const rows = [...new Set(projectIds as string[])].map(project_id => ({ project_id, user_id: userId, is_primary: false }))
    const { error: psErr } = await service.from('project_staff').upsert(rows, { onConflict: 'project_id,user_id', ignoreDuplicates: true })
    if (psErr) return bad(`User created, but assigning projects failed: ${psErr.message}`, 500)
  }

  const mail = isEmailConfigured()
    ? await emailSetPasswordLink({ to: email, name: fullName ?? null, link: gen.link, invitedBy: guard.session.profile.full_name, isNew: true })
    : { error: 'Email is not set up on the server' }

  return Response.json({ id: userId, link: gen.link, emailed: !mail.error, emailError: mail.error })
}
