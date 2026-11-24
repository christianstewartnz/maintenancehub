import { cache } from 'react'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { STAFF_PROFILE_SELECT, type StaffProfile } from '@/lib/types'

/**
 * Server-side session helpers (server components and route handlers only) for roles and project access.
 *
 * Access to data is enforced by RLS in the database (see migration
 * 20261204_staff_roles_permissions): a staff user's normal Supabase client only
 * returns rows for their projects. These helpers are for the UI (show/hide admin
 * controls) and for API routes that use the service-role client, which bypasses RLS.
 */

export interface Session {
  user: User
  profile: StaffProfile
}

/** The signed-in user and their profile, or null. Cached per request. */
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('profiles')
    .select(STAFF_PROFILE_SELECT)
    .eq('id', user.id)
    .maybeSingle()
  if (!profile) return null
  return { user, profile: profile as StaffProfile }
})

export function isAdmin(profile: Pick<StaffProfile, 'role' | 'is_active'> | null | undefined): boolean {
  return !!profile && profile.is_active && profile.role === 'admin'
}

type Guard = { session: Session; error?: undefined } | { session?: undefined; error: Response }

/** For API routes: a signed-in, active user, or a 401/403 Response to return. */
export async function requireUser(): Promise<Guard> {
  const session = await getSession()
  if (!session) return { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!session.profile.is_active) return { error: Response.json({ error: 'Your account is deactivated' }, { status: 403 }) }
  return { session }
}

/** For API routes: a signed-in admin, or a 401/403 Response to return. */
export async function requireAdmin(): Promise<Guard> {
  const res = await requireUser()
  if (res.error) return res
  if (!isAdmin(res.session.profile)) return { error: Response.json({ error: 'Admins only' }, { status: 403 }) }
  return res
}

/**
 * Can the signed-in user see this project? Checks through RLS with the user's own
 * client, so it's safe to call before using the service-role client.
 */
export async function canAccessProject(projectId: string): Promise<boolean> {
  const supabase = await createClient()
  const { data } = await supabase.from('projects').select('id').eq('id', projectId).maybeSingle()
  return !!data
}

/** Can the signed-in user see this maintenance item? (RLS-checked, as above.) */
export async function canAccessItem(itemId: string): Promise<boolean> {
  const supabase = await createClient()
  const { data } = await supabase.from('maintenance_items').select('id').eq('id', itemId).maybeSingle()
  return !!data
}
