import { createClient } from '@/lib/supabase/server'
import { buildMaintenanceWorkbook, type ExportItem } from '@/lib/export-maintenance'
import type { MaintenanceStatus } from '@/lib/types'
import { ASSIGNEE_ME, ASSIGNEE_UNASSIGNED, profileName } from '@/lib/assignees'

const STATUSES: MaintenanceStatus[] = ['logged', 'assigned', 'in_progress', 'contractor_complete', 'complete']

// GET /api/maintenance/export?project=&unit=&status=&contractor=&assignee=&q=
//   assignee: 'me' (mine + unassigned) | 'unassigned' | <user id> (only that user's)
// Mirrors the filters on the Maintenance page and returns an .xlsx workbook:
//   - unit filter set   → single sheet for that unit
//   - otherwise         → Summary tab + one tab per unit
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const params = new URL(request.url).searchParams
  const projectId = params.get('project') || ''
  const unitId = params.get('unit') || ''
  const status = params.get('status') || ''
  const contractorId = params.get('contractor') || ''
  const search = (params.get('q') || '').trim().toLowerCase()
  const assignee = params.get('assignee') || ''

  let query = supabase
    .from('maintenance_items')
    .select(`
      id, item_number, title, description, status, created_at,
      assignee:profiles(full_name, email),
      unit:units(id, unit_identifier, lot_number, address, settlement_date,
        owners:unit_owners(name, email, phone),
        project:projects(id, name)),
      trade:trades(name),
      contractor:contractors(company_name, contact_name)
    `)
    .eq('has_steps', false) // a job split into steps exports as its steps (MI-0166-1, -2…), each with its own trade/contractor
    .order('item_number')

  let projectName: string | null = null
  if (unitId) {
    query = query.eq('unit_id', unitId)
  } else if (projectId) {
    const [{ data: units, error: unitsErr }, { data: project }] = await Promise.all([
      supabase.from('units').select('id').eq('project_id', projectId),
      supabase.from('projects').select('name').eq('id', projectId).single(),
    ])
    if (unitsErr) return Response.json({ error: unitsErr.message }, { status: 500 })
    projectName = project?.name ?? null
    const ids = (units ?? []).map(u => u.id)
    if (!ids.length) query = query.eq('unit_id', '00000000-0000-0000-0000-000000000000')
    else query = query.in('unit_id', ids)
  }
  // Matches the page: no status filter means all open (non-complete) items;
  // archived items only appear in the "archived" view.
  if (status === 'archived') query = query.not('archived_at', 'is', null)
  else {
    query = query.is('archived_at', null)
    if (status && STATUSES.includes(status as MaintenanceStatus)) query = query.eq('status', status)
    else query = query.neq('status', 'complete')
  }
  if (contractorId === 'none') query = query.is('contractor_id', null)
  else if (contractorId) query = query.eq('contractor_id', contractorId)

  let assigneeLabel: string | null = null
  if (assignee === ASSIGNEE_ME) {
    query = query.or(`assigned_to.is.null,assigned_to.eq.${user.id}`)
    const { data: me } = await supabase.from('profiles').select('full_name, email').eq('id', user.id).single()
    assigneeLabel = `${profileName(me ?? { full_name: null, email: user.email ?? null })} + unassigned`
  } else if (assignee === ASSIGNEE_UNASSIGNED) {
    query = query.is('assigned_to', null)
    assigneeLabel = 'Unassigned'
  } else if (assignee) {
    const { data: who } = await supabase.from('profiles').select('full_name, email').eq('id', assignee).maybeSingle()
    if (!who) return Response.json({ error: 'Unknown assignee' }, { status: 400 })
    query = query.eq('assigned_to', assignee)
    assigneeLabel = profileName(who)
  }

  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })

  let items = (data ?? []) as unknown as ExportItem[]
  if (search) {
    items = items.filter(i =>
      i.title?.toLowerCase().includes(search) ||
      i.description?.toLowerCase().includes(search) ||
      i.item_number?.toLowerCase().includes(search) ||
      i.unit?.unit_identifier?.toLowerCase().includes(search) ||
      i.unit?.address?.toLowerCase().includes(search),
    )
  }

  if (!items.length) {
    return Response.json({ error: 'No maintenance items match the current filters' }, { status: 404 })
  }

  const { buffer, filename } = await buildMaintenanceWorkbook(items, {
    projectName: projectName ?? (unitId ? items[0].unit?.project?.name ?? null : null),
    singleUnit: !!unitId,
    assigneeLabel,
  })

  return new Response(buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename.replace(/[^\x20-\x7e]/g, '-')}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'no-store',
    },
  })
}
