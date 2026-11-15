import type { Profile } from './types'

/** Assignee filter values shared by the Maintenance page and the export route. */
export const ASSIGNEE_ALL = ''
/** My items: assigned to the current user, plus unassigned items (they're for everyone). */
export const ASSIGNEE_ME = 'me'
export const ASSIGNEE_UNASSIGNED = 'unassigned'

export function profileName(p: Pick<Profile, 'email' | 'full_name'> | null | undefined): string {
  if (!p) return 'Unassigned'
  return p.full_name?.trim() || p.email?.split('@')[0] || 'Unknown user'
}

/**
 * Does an item's assigned_to match the filter?
 * '' → everything · 'me' → mine + unassigned · 'unassigned' → only unassigned · <uuid> → exactly that user
 */
export function matchesAssignee(assignedTo: string | null | undefined, filter: string, currentUserId: string): boolean {
  if (!filter) return true
  if (filter === ASSIGNEE_ME) return !assignedTo || assignedTo === currentUserId
  if (filter === ASSIGNEE_UNASSIGNED) return !assignedTo
  return assignedTo === filter
}
