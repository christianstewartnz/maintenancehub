import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Which projects each email recipient may see, for the scheduled emails that run
 * on the service-role client (which bypasses RLS): admins see every project, staff
 * only their project_staff projects, inactive or unknown users nothing.
 * Mirrors mh_can_access_project() in the database.
 */
export type ProjectAccess = 'all' | Set<string>

export async function projectAccessByUser(service: SupabaseClient, userIds: string[]): Promise<Map<string, ProjectAccess>> {
  const out = new Map<string, ProjectAccess>()
  if (!userIds.length) return out
  const [{ data: profiles }, { data: staff }] = await Promise.all([
    service.from('profiles').select('id, role, is_active').in('id', userIds),
    service.from('project_staff').select('project_id, user_id').in('user_id', userIds),
  ])
  for (const p of profiles ?? []) {
    if (!p.is_active) continue
    out.set(p.id, p.role === 'admin' ? 'all' : new Set<string>())
  }
  for (const s of staff ?? []) {
    const a = out.get(s.user_id)
    if (a && a !== 'all') a.add(s.project_id)
  }
  return out
}

export function canSeeProject(access: ProjectAccess | undefined, projectId: string | null | undefined): boolean {
  if (!access || !projectId) return false
  return access === 'all' || access.has(projectId)
}
