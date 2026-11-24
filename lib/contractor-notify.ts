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

import type { SupabaseClient } from '@supabase/supabase-js'
import type { MaintenanceStatus } from './types'
import { effectiveResponsible } from './staff'

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

// ---------- Pending items, scoped to who is responsible ----------
//
// Each staff member notifies contractors about their own items: those whose
// effective responsible person (Responsible → parent job's → project main contact,
// as mh_item_responsible / effectiveResponsible) is them.

/** Columns withResponsible() needs on every row. */
export const RESPONSIBLE_COLUMNS = 'assigned_to, parent_item_id, unit:units(project_id)'

/** Columns for the Notify dialog's item list (plus RESPONSIBLE_COLUMNS' unit.project_id). */
export const PENDING_NOTIFY_SELECT =
  'id, item_number, title, contractor_id, assigned_to, parent_item_id, unit:units(project_id, unit_identifier, address, project:projects(name))'

type ResponsibleRow = {
  id: string
  assigned_to: string | null
  parent_item_id: string | null
  unit: { project_id: string } | null
}

/**
 * Items waiting to be notified (contractor set, not yet told, not hidden, still
 * open), with the given columns. Optionally limited to one contractor.
 */
export function pendingNotifyQuery(client: SupabaseClient, select: string = PENDING_NOTIFY_SELECT, contractorId?: string) {
  let q = client
    .from('maintenance_items')
    .select(select)
    .not('contractor_id', 'is', null)
    .is('contractor_notified_at', null)
    .eq('portal_hidden', false)
    .is('archived_at', null)
    .not('status', 'in', NOT_PENDING_FILTER)
  if (contractorId) q = q.eq('contractor_id', contractorId)
  return q.order('created_at')
}

/**
 * Adds responsible_id (effective responsible user) to each row. Looks up parent
 * jobs' Responsible and the projects' main contacts with the same client, so with a
 * user's client it only resolves what RLS lets them see (always enough for their
 * own projects' items).
 */
export async function withResponsible<T extends ResponsibleRow>(
  client: SupabaseClient,
  rows: T[],
): Promise<(T & { responsible_id: string | null })[]> {
  const parentIds = [...new Set(rows.filter(r => !r.assigned_to && r.parent_item_id).map(r => r.parent_item_id!))]
  const projectIds = [...new Set(rows.map(r => r.unit?.project_id).filter((x): x is string => !!x))]
  const [{ data: parents }, { data: contacts }] = await Promise.all([
    parentIds.length
      ? client.from('maintenance_items').select('id, assigned_to').in('id', parentIds)
      : Promise.resolve({ data: [] as { id: string; assigned_to: string | null }[] }),
    projectIds.length
      ? client.from('project_staff').select('project_id, user_id').eq('is_primary', true).in('project_id', projectIds)
      : Promise.resolve({ data: [] as { project_id: string; user_id: string }[] }),
  ])
  const parentAssignee = new Map((parents ?? []).map(p => [p.id as string, p.assigned_to as string | null]))
  const contactByProject = new Map((contacts ?? []).map(c => [c.project_id as string, c.user_id as string]))
  return rows.map(r => ({
    ...r,
    responsible_id: effectiveResponsible(
      r.assigned_to,
      r.parent_item_id ? parentAssignee.get(r.parent_item_id) : null,
      r.unit?.project_id ? contactByProject.get(r.unit.project_id) : null,
    ),
  }))
}

/** The signed-in user's pending items (with a user's client: RLS-scoped too). */
export async function fetchMyPendingNotify<T extends ResponsibleRow = ResponsibleRow>(
  client: SupabaseClient,
  userId: string,
  opts: { select?: string; contractorId?: string } = {},
): Promise<{ mine: (T & { responsible_id: string | null })[]; others: (T & { responsible_id: string | null })[]; error: string | null }> {
  const { data, error } = await pendingNotifyQuery(client, opts.select, opts.contractorId)
  if (error) return { mine: [], others: [], error: error.message }
  const rows = await withResponsible(client, (data ?? []) as unknown as T[])
  return {
    mine: rows.filter(r => r.responsible_id === userId),
    others: rows.filter(r => r.responsible_id !== userId),
    error: null,
  }
}
