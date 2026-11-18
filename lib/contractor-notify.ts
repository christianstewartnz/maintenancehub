/**
 * "New items" contractor notifications.
 *
 * An item is pending notification when it has a contractor, the contractor
 * still has work to do on it, and it hasn't been emailed (or marked as told)
 * since it was assigned. A DB trigger clears `contractor_notified_at` when the
 * item is reassigned or sent back from contractor_complete.
 *
 * "Assigned" means the contractor has been told: an item with a contractor stays
 * Logged until it's notified, then a DB trigger (sync_assigned_status) moves it
 * to Assigned. Reassigning drops it back to Logged until the new contractor is told.
 */

import type { MaintenanceStatus } from './types'

/**
 * The status an item ends up with after its contractor is changed, matching the
 * DB trigger — use it to update local state without a refetch.
 */
export function statusAfterContractorChange(
  item: { status: MaintenanceStatus; contractor_id: string | null },
  contractorId: string | null,
): MaintenanceStatus {
  if (item.status !== 'logged' && item.status !== 'assigned') return item.status
  return contractorId === item.contractor_id ? item.status : 'logged'
}

/** Statuses where the contractor has nothing to act on, so no notification is needed. */
export const NOT_PENDING_STATUSES = ['contractor_complete', 'complete', 'cancelled'] as const

/** PostgREST filter value for `.not('status', 'in', …)`. */
export const NOT_PENDING_FILTER = `(${NOT_PENDING_STATUSES.join(',')})`

/** Items notified within this many days show a "New" tag in the contractor portal. */
export const PORTAL_NEW_DAYS = 7

/** Window event that tells the sidebar to re-fetch its badge counts. */
export const COUNTS_CHANGED_EVENT = 'mh:counts-changed'
