import { createClient } from '@/lib/supabase/server'
import { requireUser } from '@/lib/auth'

const ids = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string'))] : []

/**
 * PATCH /api/work-orders/[id]
 * Body: { archived?: boolean, notes?: string | null, add_item_ids?: string[], remove_item_ids?: string[] }
 *
 *  - archived: archive / restore. Any status. Archiving a DRAFT also takes its items off
 *    it, so they can go on another work order; a sent one keeps them as a record.
 *  - notes / items: only while the work order is a draft (not sent, not archived).
 *    Added items must be this contractor's open, unassigned items on the same unit
 *    (a work order covers one unit), and at least one item must remain.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const auth = await requireUser()
  if (auth.error) return auth.error
  // The user's own client: RLS limits staff to work orders on their projects.
  const supabase = await createClient()

  const body = await req.json().catch(() => ({})) as Record<string, unknown>

  const { data: wo } = await supabase
    .from('work_orders')
    .select('id, status, archived_at, project_id, contractor_id')
    .eq('id', id)
    .single()
  if (!wo) return Response.json({ error: 'Work order not found' }, { status: 404 })

  // ── Archive / restore ──
  if (typeof body.archived === 'boolean') {
    if (body.archived) {
      if (wo.status === 'draft') {
        const { error } = await supabase.from('maintenance_items').update({ work_order_id: null }).eq('work_order_id', id)
        if (error) return Response.json({ error: `Couldn't release the items: ${error.message}` }, { status: 500 })
      }
      const { error } = await supabase.from('work_orders').update({ archived_at: new Date().toISOString() }).eq('id', id)
      if (error) return Response.json({ error: error.message }, { status: 500 })
    } else {
      const { error } = await supabase.from('work_orders').update({ archived_at: null }).eq('id', id)
      if (error) return Response.json({ error: error.message }, { status: 500 })
    }
    return Response.json({ success: true })
  }

  // ── Edits (drafts only) ──
  if (wo.status !== 'draft') {
    return Response.json({ error: 'This work order has been sent and can no longer be edited.' }, { status: 409 })
  }
  if (wo.archived_at) {
    return Response.json({ error: 'This work order is archived. Restore it to edit.' }, { status: 409 })
  }

  const addIds = ids(body.add_item_ids)
  const removeIds = ids(body.remove_item_ids).filter(x => !addIds.includes(x))

  if (addIds.length || removeIds.length) {
    const { data: current } = await supabase.from('maintenance_items').select('id, unit_id').eq('work_order_id', id)
    const currentIds = new Set((current ?? []).map(i => i.id))
    const remaining = (current ?? []).filter(i => !removeIds.includes(i.id))

    let toAdd: { id: string; unit_id: string }[] = []
    if (addIds.length) {
      const { data: candidates } = await supabase
        .from('maintenance_items')
        .select('id, unit_id, status, contractor_id, work_order_id, archived_at, unit:units!inner(project_id)')
        .in('id', addIds)
      toAdd = (candidates ?? []).filter(i => !currentIds.has(i.id))
      const bad = (candidates ?? []).filter(i =>
        !currentIds.has(i.id) && (
          i.contractor_id !== wo.contractor_id
          || (i.unit as any)?.project_id !== wo.project_id
          || i.work_order_id !== null
          || i.archived_at !== null
          || i.status === 'complete'))
      if (bad.length || (candidates ?? []).length !== addIds.length) {
        return Response.json({ error: 'Some items can no longer be added (already on a work order, complete, or not this contractor’s). Refresh and try again.' }, { status: 400 })
      }
    }

    const units = new Set([...remaining, ...toAdd].map(i => i.unit_id))
    if (units.size === 0) {
      return Response.json({ error: 'A work order needs at least one item. To cancel it, archive it instead.' }, { status: 400 })
    }
    if (units.size > 1) {
      return Response.json({ error: 'A work order covers one unit: all items must be on the same unit.' }, { status: 400 })
    }

    if (removeIds.length) {
      const { error } = await supabase.from('maintenance_items').update({ work_order_id: null }).in('id', removeIds).eq('work_order_id', id)
      if (error) return Response.json({ error: error.message }, { status: 500 })
    }
    if (toAdd.length) {
      const { error } = await supabase.from('maintenance_items').update({ work_order_id: id }).in('id', toAdd.map(i => i.id)).is('work_order_id', null)
      if (error) return Response.json({ error: error.message }, { status: 500 })
    }
  }

  if ('notes' in body) {
    const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 8000) || null : null
    const { error } = await supabase.from('work_orders').update({ notes }).eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ success: true })
}
