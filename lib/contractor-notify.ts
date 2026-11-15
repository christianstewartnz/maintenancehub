/**
 * "New items" contractor notifications.
 *
 * An item is pending notification when it has a contractor, the contractor
 * still has work to do on it, and it hasn't been emailed (or marked as told)
 * since it was assigned. A DB trigger clears `contractor_notified_at` when the
 * item is reassigned or sent back from contractor_complete.
 */

/** Statuses where the contractor has nothing to act on, so no notification is needed. */
export const NOT_PENDING_STATUSES = ['contractor_complete', 'complete', 'cancelled'] as const

/** PostgREST filter value for `.not('status', 'in', …)`. */
export const NOT_PENDING_FILTER = `(${NOT_PENDING_STATUSES.join(',')})`

/** Items notified within this many days show a "New" tag in the contractor portal. */
export const PORTAL_NEW_DAYS = 7

/** Window event that tells the sidebar to re-fetch its badge counts. */
export const COUNTS_CHANGED_EVENT = 'mh:counts-changed'
