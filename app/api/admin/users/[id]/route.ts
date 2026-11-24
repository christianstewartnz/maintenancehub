import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { bad, cleanName, cleanPhone, isRole, isUuid, readJson } from '../../_lib/validate'

// Long enough to be permanent; reactivating sets it back to 'none'.
const BAN_FOREVER = '876000h'

/**
 * PATCH /api/admin/users/[id] — edit a user (admin only).
 * Body (all optional): { full_name, phone, role: 'admin'|'staff', is_active: boolean }
 * Deactivating also bans the user in Supabase Auth so their session can't refresh
 * and they can't sign in again; reactivating lifts the ban.
 * You can't demote or deactivate yourself, or the last active admin.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin()
  if (guard.error) return guard.error
  const { id } = await params
  if (!isUuid(id)) return bad('Invalid user')

  const body = await readJson(req)
  if (!body) return bad('Invalid request')

  const update: Record<string, unknown> = {}
  const fullName = cleanName(body.full_name)
  if (fullName instanceof Error) return bad(fullName.message)
  if (fullName !== undefined) update.full_name = fullName
  const phone = cleanPhone(body.phone)
  if (phone instanceof Error) return bad(phone.message)
  if (phone !== undefined) update.phone = phone
  if (body.role !== undefined) {
    if (!isRole(body.role)) return bad('Role must be admin or staff')
    update.role = body.role
  }
  if (body.is_active !== undefined) {
    if (typeof body.is_active !== 'boolean') return bad('is_active must be true or false')
    update.is_active = body.is_active
  }
  if (!Object.keys(update).length) return bad('Nothing to change')

  const service = createServiceClient()
  const { data: target } = await service.from('profiles').select('id, role, is_active').eq('id', id).maybeSingle()
  if (!target) return bad('User not found', 404)

  const losesAdmin = target.role === 'admin' && target.is_active
    && (update.role === 'staff' || update.is_active === false)
  if (losesAdmin) {
    if (id === guard.session.user.id) {
      return bad(update.is_active === false ? "You can't deactivate yourself." : "You can't remove your own admin role.")
    }
    const { count } = await service
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'admin')
      .eq('is_active', true)
      .neq('id', id)
    if (!count) return bad('This is the last active admin. Make someone else an admin first.')
  }
  if (update.is_active === false && id === guard.session.user.id) return bad("You can't deactivate yourself.")

  // Applied even if the profile already matches, so retrying fixes a half-finished change.
  const activating = update.is_active === true
  const deactivating = update.is_active === false

  // Reactivate: lift the auth ban first so a failure doesn't leave an "active" user who can't sign in.
  if (activating) {
    const { error } = await service.auth.admin.updateUserById(id, { ban_duration: 'none' })
    if (error) return bad(`Could not reactivate sign-in: ${error.message}`, 502)
  }

  update.updated_at = new Date().toISOString()
  const { data: profile, error } = await service.from('profiles').update(update).eq('id', id).select('id').single()
  if (error || !profile) return bad(error?.message ?? 'Could not update user', 500)

  // Deactivate: profile first (RLS stops them seeing data at once), then ban so the session dies.
  if (deactivating) {
    const { error: banErr } = await service.auth.admin.updateUserById(id, { ban_duration: BAN_FOREVER })
    if (banErr) return bad(`Deactivated, but blocking their sign-in failed: ${banErr.message}. Try again.`, 502)
  }

  return Response.json({ ok: true })
}
