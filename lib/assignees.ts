import type { Profile } from './types'

/**
 * "Responsible" filter values shared by the Maintenance and Sign-off pages and the export route.
 *
 * Filters match an item's *effective* responsible person (lib/staff effectiveResponsible):
 * its own Responsible, else its job's, else the project's main contact.
 * Values saved in localStorage by older versions ('me', 'unassigned', a user id) still work.
 */
export const ASSIGNEE_ALL = ''
/** My items: the effective responsible person is me (includes items that fall to me as main contact). */
export const ASSIGNEE_ME = 'me'
/** No Responsible set on the item itself (it falls to the job's person or the main contact). */
export const ASSIGNEE_UNASSIGNED = 'unassigned'

export function profileName(p: Pick<Profile, 'email' | 'full_name'> | null | undefined): string {
  if (!p) return 'Unassigned'
  return p.full_name?.trim() || p.email?.split('@')[0] || 'Unknown user'
}

/**
 * Does an item match the Responsible filter?
 * '' → everything · 'me' → effective responsible is me · 'unassigned' → no Responsible set on the item
 * <uuid> → effective responsible is that user
 */
export function matchesAssignee(
  assignedTo: string | null | undefined,
  effective: string | null | undefined,
  filter: string,
  currentUserId: string,
): boolean {
  if (!filter) return true
  if (filter === ASSIGNEE_ME) return !!currentUserId && effective === currentUserId
  if (filter === ASSIGNEE_UNASSIGNED) return !assignedTo
  return effective === filter
}

/**
 * Label for the empty choice of a Responsible dropdown: who the item falls to when no one is set,
 * e.g. "Christian (main contact)" or "Aidan (from job)".
 */
export function fallbackResponsibleLabel(
  fallback: Pick<Profile, 'id' | 'email' | 'full_name'> | null | undefined,
  fromJob: boolean,
  currentUserId?: string,
): string {
  if (!fallback) return 'No one (no main contact)'
  const me = fallback.id === currentUserId ? ', me' : ''
  return `${profileName(fallback)} (${fromJob ? 'from job' : 'main contact'}${me})`
}
