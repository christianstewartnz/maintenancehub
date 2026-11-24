import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { bad, isUuid, readJson } from '../_lib/validate'

/**
 * Project staff assignments (admin only). Used by Settings → Team and the
 * project page's Staff card.
 *
 *   POST   { project_id, user_id, is_primary? }  add someone to a project
 *   PATCH  { project_id, user_id, is_primary }   make / unmake the main contact
 *   DELETE { project_id, user_id }               remove them from the project
 */

async function parse(req: Request) {
  const body = await readJson(req)
  if (!body || !isUuid(body.project_id) || !isUuid(body.user_id)) return null
  return { projectId: body.project_id, userId: body.user_id, isPrimary: body.is_primary }
}

/** Makes userId the project's only main contact. The old one is cleared first (one-primary unique index). */
async function setPrimary(service: ReturnType<typeof createServiceClient>, projectId: string, userId: string) {
  const { error: clearErr } = await service
    .from('project_staff')
    .update({ is_primary: false })
    .eq('project_id', projectId)
    .eq('is_primary', true)
    .neq('user_id', userId)
  if (clearErr) return clearErr.message
  const { error } = await service
    .from('project_staff')
    .update({ is_primary: true })
    .eq('project_id', projectId)
    .eq('user_id', userId)
  return error?.message ?? null
}

export async function POST(req: Request) {
  const guard = await requireAdmin()
  if (guard.error) return guard.error
  const p = await parse(req)
  if (!p) return bad('Invalid request')

  const service = createServiceClient()
  const [{ data: project }, { data: profile }] = await Promise.all([
    service.from('projects').select('id').eq('id', p.projectId).maybeSingle(),
    service.from('profiles').select('id, is_active').eq('id', p.userId).maybeSingle(),
  ])
  if (!project) return bad('Project not found', 404)
  if (!profile) return bad('User not found', 404)
  if (!profile.is_active) return bad('That user is deactivated. Reactivate them first.')

  const { error } = await service
    .from('project_staff')
    .upsert({ project_id: p.projectId, user_id: p.userId }, { onConflict: 'project_id,user_id', ignoreDuplicates: true })
  if (error) return bad(error.message, 500)

  if (p.isPrimary === true) {
    const err = await setPrimary(service, p.projectId, p.userId)
    if (err) return bad(`Added, but setting the main contact failed: ${err}`, 500)
  }
  return Response.json({ ok: true })
}

export async function PATCH(req: Request) {
  const guard = await requireAdmin()
  if (guard.error) return guard.error
  const p = await parse(req)
  if (!p || typeof p.isPrimary !== 'boolean') return bad('Invalid request')

  const service = createServiceClient()
  const { data: row } = await service
    .from('project_staff')
    .select('user_id, profile:profiles(is_active)')
    .eq('project_id', p.projectId)
    .eq('user_id', p.userId)
    .maybeSingle()
  if (!row) return bad('That user is not on this project', 404)

  if (p.isPrimary) {
    const prof = row.profile as unknown as { is_active: boolean } | null
    if (!prof?.is_active) return bad('A deactivated user can’t be the main contact.')
    const err = await setPrimary(service, p.projectId, p.userId)
    if (err) return bad(err, 500)
  } else {
    const { error } = await service
      .from('project_staff')
      .update({ is_primary: false })
      .eq('project_id', p.projectId)
      .eq('user_id', p.userId)
    if (error) return bad(error.message, 500)
  }
  return Response.json({ ok: true })
}

export async function DELETE(req: Request) {
  const guard = await requireAdmin()
  if (guard.error) return guard.error
  const p = await parse(req)
  if (!p) return bad('Invalid request')

  const service = createServiceClient()
  const { error } = await service
    .from('project_staff')
    .delete()
    .eq('project_id', p.projectId)
    .eq('user_id', p.userId)
  if (error) return bad(error.message, 500)
  return Response.json({ ok: true })
}
