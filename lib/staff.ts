import type { SupabaseClient } from '@supabase/supabase-js'
import { STAFF_PROFILE_SELECT, type ProjectStaff, type StaffProfile } from './types'

/**
 * Project staff helpers, usable on the client and the server.
 *
 * Who is responsible for an item: its own Responsible person (assigned_to),
 * else its parent job's (for steps), else the project's main contact. The DB
 * function mh_item_responsible(item_id) applies the same rule.
 */

export function effectiveResponsible(
  assignedTo: string | null | undefined,
  parentAssignedTo: string | null | undefined,
  projectContactId: string | null | undefined,
): string | null {
  return assignedTo || parentAssignedTo || projectContactId || null
}

/** The main contact's user id from a project's staff list. */
export function primaryContactId(staff: Pick<ProjectStaff, 'user_id' | 'is_primary'>[]): string | null {
  return staff.find(s => s.is_primary)?.user_id ?? null
}

/** Staff rows for the given projects (RLS limits staff users to their own projects). */
export async function fetchProjectStaff(supabase: SupabaseClient, projectIds?: string[]): Promise<ProjectStaff[]> {
  let q = supabase
    .from('project_staff')
    .select(`project_id, user_id, is_primary, created_at, profile:profiles(${STAFF_PROFILE_SELECT})`)
  if (projectIds) q = q.in('project_id', projectIds)
  const { data } = await q
  return (data ?? []) as unknown as ProjectStaff[]
}

/** project_id → main contact user id. */
export function primaryContactByProject(staff: ProjectStaff[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const s of staff) if (s.is_primary) m.set(s.project_id, s.user_id)
  return m
}

/** Active staff profiles on a project, main contact first — for "Responsible" dropdowns. */
export function projectStaffProfiles(staff: ProjectStaff[], projectId: string): StaffProfile[] {
  return staff
    .filter(s => s.project_id === projectId && s.profile?.is_active)
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
    .map(s => s.profile!)
}
