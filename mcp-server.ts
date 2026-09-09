#!/usr/bin/env npx tsx
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import * as dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '.env.local') })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const server = new McpServer({ name: 'maintenance-hub', version: '3.0.0' })

// ─── helpers ────────────────────────────────────────────────────────────────

async function resolveProject(name: string) {
  const { data } = await supabase
    .from('projects')
    .select('id, name, address')
    .ilike('name', `%${name}%`)
    .limit(1)
    .single()
  return data
}

async function resolveProjectAny(nameOrId: string) {
  if (/^[0-9a-f-]{36}$/.test(nameOrId)) {
    const { data } = await supabase.from('projects').select('id, name, address').eq('id', nameOrId).single()
    return data
  }
  return resolveProject(nameOrId)
}

async function resolveContractor(nameOrId: string) {
  if (/^[0-9a-f-]{36}$/.test(nameOrId)) {
    const { data } = await supabase.from('contractors').select('id, company_name, email, phone').eq('id', nameOrId).single()
    return data
  }
  const { data } = await supabase
    .from('contractors')
    .select('id, company_name, email, phone')
    .ilike('company_name', `%${nameOrId}%`)
    .limit(1)
    .single()
  return data
}

async function unitIdsForProject(projectId: string) {
  const { data } = await supabase.from('units').select('id').eq('project_id', projectId)
  return data?.map(u => u.id) ?? []
}

async function resolveItemByNumber(itemNumber: string) {
  const { data } = await supabase
    .from('maintenance_items')
    .select('id, item_number, title, status')
    .eq('item_number', itemNumber)
    .single()
  return data
}

async function logActivity(itemId: string, action: string, details?: Record<string, unknown>) {
  await supabase.from('activity_log').insert({
    maintenance_item_id: itemId,
    action,
    details: details ?? null,
    performed_by: 'MCP',
  })
}

// ─── PROJECTS ───────────────────────────────────────────────────────────────

server.tool('list_projects', 'List all active projects', {}, async () => {
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, address, development_company, status')
    .eq('status', 'active')
    .order('name')

  if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
  const text = data.map(p =>
    `• ${p.name}${p.development_company ? ` (${p.development_company})` : ''} | ${p.address ?? 'no address'} [id: ${p.id}]`
  ).join('\n')
  return { content: [{ type: 'text', text: text || 'No active projects.' }] }
})

server.tool(
  'create_project',
  'Create a new project',
  {
    name: z.string().describe('Project name'),
    development_company: z.string().optional().describe('Development company name'),
    address: z.string().optional().describe('Project address'),
    description: z.string().optional(),
  },
  async ({ name, development_company, address, description }) => {
    const { data, error } = await supabase
      .from('projects')
      .insert({ name, development_company: development_company ?? null, address: address ?? null, description: description ?? null })
      .select('id, name')
      .single()

    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
    return { content: [{ type: 'text', text: `Project created: ${data.name} [id: ${data.id}]` }] }
  },
)

server.tool(
  'update_project',
  'Update a project\'s details',
  {
    project: z.string().describe('Project name (partial) or ID'),
    name: z.string().optional(),
    development_company: z.string().optional(),
    address: z.string().optional(),
    description: z.string().optional(),
  },
  async ({ project, ...fields }) => {
    const proj = await resolveProjectAny(project)
    if (!proj) return { content: [{ type: 'text', text: 'Project not found.' }] }

    const updates: Record<string, unknown> = {}
    if (fields.name !== undefined) updates.name = fields.name
    if (fields.development_company !== undefined) updates.development_company = fields.development_company
    if (fields.address !== undefined) updates.address = fields.address
    if (fields.description !== undefined) updates.description = fields.description

    const { error } = await supabase.from('projects').update(updates).eq('id', proj.id)
    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
    return { content: [{ type: 'text', text: `Project "${proj.name}" updated.` }] }
  },
)

server.tool(
  'archive_project',
  'Archive or restore a project',
  {
    project: z.string().describe('Project name (partial) or ID'),
    archive: z.boolean().describe('true to archive, false to restore'),
  },
  async ({ project, archive }) => {
    const proj = await resolveProjectAny(project)
    if (!proj) return { content: [{ type: 'text', text: 'Project not found.' }] }

    const { error } = await supabase
      .from('projects')
      .update({ status: archive ? 'archived' : 'active' })
      .eq('id', proj.id)

    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
    return { content: [{ type: 'text', text: `Project "${proj.name}" ${archive ? 'archived' : 'restored'}.` }] }
  },
)

server.tool(
  'get_project_status',
  'Summary of a project: item counts by status and overdue count',
  { project: z.string().describe('Project name (partial match) or project ID') },
  async ({ project }) => {
    const proj = await resolveProjectAny(project)
    if (!proj) return { content: [{ type: 'text', text: 'Project not found.' }] }

    const unitIds = await unitIdsForProject(proj.id)
    if (!unitIds.length) return { content: [{ type: 'text', text: `${proj.name} has no units.` }] }

    const { data: items } = await supabase
      .from('maintenance_items')
      .select('status, priority, created_at')
      .in('unit_id', unitIds)

    if (!items?.length) return { content: [{ type: 'text', text: `${proj.name} — no maintenance items.` }] }

    const count = (s: string) => items.filter(i => i.status === s).length
    const overdue = items.filter(
      i => ['logged', 'assigned', 'in_progress'].includes(i.status) &&
        new Date(i.created_at) < new Date(Date.now() - 14 * 86400000)
    ).length

    const lines = [
      `Project: ${proj.name} (${proj.address ?? 'no address'})`,
      `Total items: ${items.length}`,
      ``,
      `By status:`,
      `  Logged:               ${count('logged')}`,
      `  Assigned:             ${count('assigned')}`,
      `  In progress:          ${count('in_progress')}`,
      `  Contractor complete:  ${count('contractor_complete')}`,
      `  Complete:             ${count('complete')}`,
      ``,
      `Overdue (>14 days open): ${overdue}`,
    ]
    return { content: [{ type: 'text', text: lines.join('\n') }] }
  },
)

// ─── UNITS ───────────────────────────────────────────────────────────────────

server.tool(
  'list_units',
  'List units for a project',
  { project: z.string().describe('Project name (partial) or project ID') },
  async ({ project }) => {
    const proj = await resolveProjectAny(project)
    if (!proj) return { content: [{ type: 'text', text: 'Project not found.' }] }

    const { data, error } = await supabase
      .from('units')
      .select('id, unit_identifier, lot_number, address, owner_name, owner_email, owner_phone, settlement_date')
      .eq('project_id', proj.id)
      .order('lot_number', { ascending: true })

    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
    const text = data.map(u =>
      `[${u.id}] Construction No. ${u.unit_identifier}${u.lot_number ? ` | Lot ${u.lot_number}` : ''}${u.address ? ` | ${u.address}` : ''}${u.owner_name ? ` | ${u.owner_name}` : ''}${u.settlement_date ? ` | settled ${u.settlement_date}` : ''}`
    ).join('\n')
    return { content: [{ type: 'text', text: `Units for ${proj.name}:\n\n${text || 'No units.'}` }] }
  },
)

server.tool(
  'get_unit',
  'Get full details for a single unit by ID',
  { unit_id: z.string().describe('Unit ID (from list_units)') },
  async ({ unit_id }) => {
    const { data, error } = await supabase
      .from('units')
      .select('*, project:projects(name)')
      .eq('id', unit_id)
      .single()

    if (error || !data) return { content: [{ type: 'text', text: 'Unit not found.' }] }

    const lines = [
      `Project: ${(data.project as any)?.name ?? '?'}`,
      `Construction No.: ${data.unit_identifier}`,
      `Lot number: ${data.lot_number ?? '—'}`,
      `Address: ${data.address ?? '—'}`,
      `Owner: ${data.owner_name ?? '—'} | ${data.owner_email ?? '—'} | ${data.owner_phone ?? '—'}`,
      `Access contact: ${data.access_contact_name ?? '—'} | ${data.access_contact_email ?? '—'} | ${data.access_contact_phone ?? '—'}`,
      `Settlement date: ${data.settlement_date ?? '—'}`,
      `Notes: ${data.notes ?? '—'}`,
    ]
    return { content: [{ type: 'text', text: lines.join('\n') }] }
  },
)

server.tool(
  'create_unit',
  'Create a new unit in a project',
  {
    project: z.string().describe('Project name (partial) or ID'),
    unit_identifier: z.string().describe('Construction number / unit identifier'),
    lot_number: z.string().optional(),
    address: z.string().optional(),
    owner_name: z.string().optional(),
    owner_email: z.string().optional(),
    owner_phone: z.string().optional(),
    access_contact_name: z.string().optional(),
    access_contact_email: z.string().optional(),
    access_contact_phone: z.string().optional(),
    settlement_date: z.string().optional().describe('ISO date string e.g. 2025-06-01'),
    notes: z.string().optional(),
  },
  async ({ project, unit_identifier, ...fields }) => {
    const proj = await resolveProjectAny(project)
    if (!proj) return { content: [{ type: 'text', text: 'Project not found.' }] }

    const { data, error } = await supabase
      .from('units')
      .insert({ project_id: proj.id, unit_identifier, ...fields })
      .select('id, unit_identifier')
      .single()

    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
    return { content: [{ type: 'text', text: `Unit ${data.unit_identifier} created [id: ${data.id}]` }] }
  },
)

server.tool(
  'update_unit',
  'Update a unit\'s details',
  {
    unit_id: z.string().describe('Unit ID (from list_units)'),
    unit_identifier: z.string().optional().describe('Construction number'),
    lot_number: z.string().optional(),
    address: z.string().optional(),
    owner_name: z.string().optional(),
    owner_email: z.string().optional(),
    owner_phone: z.string().optional(),
    access_contact_name: z.string().optional(),
    access_contact_email: z.string().optional(),
    access_contact_phone: z.string().optional(),
    settlement_date: z.string().optional().describe('ISO date string e.g. 2025-06-01, or empty string to clear'),
    notes: z.string().optional(),
  },
  async ({ unit_id, ...fields }) => {
    const updates: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(fields)) {
      if (v !== undefined) updates[k] = v === '' ? null : v
    }

    const { error } = await supabase.from('units').update(updates).eq('id', unit_id)
    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
    return { content: [{ type: 'text', text: `Unit ${unit_id} updated.` }] }
  },
)

server.tool(
  'delete_unit',
  'Delete a unit (only if it has no maintenance items)',
  { unit_id: z.string().describe('Unit ID (from list_units)') },
  async ({ unit_id }) => {
    const { count } = await supabase
      .from('maintenance_items')
      .select('*', { count: 'exact', head: true })
      .eq('unit_id', unit_id)

    if (count && count > 0)
      return { content: [{ type: 'text', text: `Cannot delete: unit has ${count} maintenance item(s).` }] }

    const { error } = await supabase.from('units').delete().eq('id', unit_id)
    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
    return { content: [{ type: 'text', text: `Unit deleted.` }] }
  },
)

// ─── TRADES ──────────────────────────────────────────────────────────────────

server.tool(
  'list_trades',
  'List trades for a project, with their assigned contractors',
  { project: z.string().describe('Project name (partial) or ID') },
  async ({ project }) => {
    const proj = await resolveProjectAny(project)
    if (!proj) return { content: [{ type: 'text', text: 'Project not found.' }] }

    const { data, error } = await supabase
      .from('trades')
      .select('id, name, project_trade_assignments(id, contractor:contractors(id, company_name))')
      .eq('project_id', proj.id)
      .order('name')

    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }

    const text = data.map(t => {
      const assigned = (t.project_trade_assignments as any[])
        .map((a: any) => a.contractor?.company_name ?? '?')
        .join(', ')
      return `[${t.id}] ${t.name}${assigned ? ` → ${assigned}` : ' (no contractors assigned)'}`
    }).join('\n')

    return { content: [{ type: 'text', text: `Trades for ${proj.name}:\n\n${text || 'No trades.'}` }] }
  },
)

server.tool(
  'create_trade',
  'Add a trade to a project',
  {
    project: z.string().describe('Project name (partial) or ID'),
    name: z.string().describe('Trade name e.g. "Plumbing", "Electrical"'),
  },
  async ({ project, name }) => {
    const proj = await resolveProjectAny(project)
    if (!proj) return { content: [{ type: 'text', text: 'Project not found.' }] }

    const { data, error } = await supabase
      .from('trades')
      .insert({ project_id: proj.id, name })
      .select('id, name')
      .single()

    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
    return { content: [{ type: 'text', text: `Trade "${data.name}" created [id: ${data.id}]` }] }
  },
)

server.tool(
  'delete_trade',
  'Delete a trade from a project by trade ID',
  { trade_id: z.string().describe('Trade ID (from list_trades)') },
  async ({ trade_id }) => {
    const { error } = await supabase.from('trades').delete().eq('id', trade_id)
    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
    return { content: [{ type: 'text', text: `Trade deleted.` }] }
  },
)

server.tool(
  'assign_contractor_to_trade',
  'Assign a contractor to a trade in a project',
  {
    trade_id: z.string().describe('Trade ID (from list_trades)'),
    contractor: z.string().describe('Contractor company name (partial) or ID'),
  },
  async ({ trade_id, contractor }) => {
    const { data: trade } = await supabase.from('trades').select('id, name, project_id').eq('id', trade_id).single()
    if (!trade) return { content: [{ type: 'text', text: 'Trade not found.' }] }

    const c = await resolveContractor(contractor)
    if (!c) return { content: [{ type: 'text', text: `Contractor "${contractor}" not found.` }] }

    const { error } = await supabase.from('project_trade_assignments').insert({
      project_id: trade.project_id,
      trade_id,
      contractor_id: c.id,
    })

    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
    return { content: [{ type: 'text', text: `${c.company_name} assigned to trade "${trade.name}".` }] }
  },
)

server.tool(
  'remove_contractor_from_trade',
  'Remove a contractor assignment from a trade',
  {
    assignment_id: z.string().describe('Assignment ID (from list_trades output — the id in project_trade_assignments)'),
  },
  async ({ assignment_id }) => {
    const { error } = await supabase.from('project_trade_assignments').delete().eq('id', assignment_id)
    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
    return { content: [{ type: 'text', text: `Contractor assignment removed.` }] }
  },
)

// ─── CONTRACTORS ─────────────────────────────────────────────────────────────

server.tool('list_contractors', 'List active contractors', {}, async () => {
  const { data, error } = await supabase
    .from('contractors')
    .select('id, company_name, contact_name, email, phone')
    .eq('is_active', true)
    .order('company_name')

  if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
  const text = data.map(c =>
    `• ${c.company_name}${c.contact_name ? ` (${c.contact_name})` : ''} | ${c.email ?? '—'} | ${c.phone ?? '—'} [id: ${c.id}]`
  ).join('\n')
  return { content: [{ type: 'text', text: text || 'No active contractors.' }] }
})

server.tool(
  'get_contractor_detail',
  'Get full details for a contractor including their open and recently completed items',
  { contractor: z.string().describe('Contractor company name (partial) or ID') },
  async ({ contractor }) => {
    const c = await resolveContractor(contractor)
    if (!c) return { content: [{ type: 'text', text: `Contractor "${contractor}" not found.` }] }

    const { data: full } = await supabase
      .from('contractors')
      .select('*')
      .eq('id', c.id)
      .single()

    const { data: open } = await supabase
      .from('maintenance_items')
      .select('item_number, title, status, priority, unit:units(unit_identifier, project:projects(name))')
      .eq('contractor_id', c.id)
      .not('status', 'in', '("complete","cancelled")')
      .order('item_number')

    const { data: recent } = await supabase
      .from('maintenance_items')
      .select('item_number, title, completed_at, unit:units(unit_identifier, project:projects(name))')
      .eq('contractor_id', c.id)
      .eq('status', 'complete')
      .order('completed_at', { ascending: false })
      .limit(10)

    const lines = [
      `Company: ${full?.company_name}`,
      `Contact: ${full?.contact_name ?? '—'}`,
      `Email: ${full?.email ?? '—'}`,
      `Phone: ${full?.phone ?? '—'}`,
      `Notes: ${full?.notes ?? '—'}`,
      `Active: ${full?.is_active ? 'Yes' : 'No (archived)'}`,
      ``,
      `Open items (${open?.length ?? 0}):`,
      ...(open ?? []).map(i => {
        const u = i.unit as any
        return `  [${i.item_number}] ${i.title} | ${i.status} | ${(u?.project as any)?.name ?? '?'} · ${u?.unit_identifier ?? '?'}`
      }),
      ``,
      `Recently completed (last 10):`,
      ...(recent ?? []).map(i => {
        const u = i.unit as any
        return `  [${i.item_number}] ${i.title} | ${(u?.project as any)?.name ?? '?'} · ${u?.unit_identifier ?? '?'}`
      }),
    ]

    return { content: [{ type: 'text', text: lines.join('\n') }] }
  },
)

server.tool(
  'create_contractor',
  'Create a new contractor',
  {
    company_name: z.string(),
    contact_name: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    notes: z.string().optional(),
  },
  async ({ company_name, contact_name, email, phone, notes }) => {
    const { data, error } = await supabase
      .from('contractors')
      .insert({ company_name, contact_name: contact_name ?? null, email: email ?? null, phone: phone ?? null, notes: notes ?? null })
      .select('id, company_name, portal_token')
      .single()

    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
    return { content: [{ type: 'text', text: `Contractor "${data.company_name}" created [id: ${data.id}]` }] }
  },
)

server.tool(
  'update_contractor',
  'Update a contractor\'s details',
  {
    contractor: z.string().describe('Contractor company name (partial) or ID'),
    company_name: z.string().optional(),
    contact_name: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    notes: z.string().optional(),
  },
  async ({ contractor, ...fields }) => {
    const c = await resolveContractor(contractor)
    if (!c) return { content: [{ type: 'text', text: `Contractor "${contractor}" not found.` }] }

    const updates: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(fields)) {
      if (v !== undefined) updates[k] = v
    }

    const { error } = await supabase.from('contractors').update(updates).eq('id', c.id)
    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
    return { content: [{ type: 'text', text: `Contractor "${c.company_name}" updated.` }] }
  },
)

server.tool(
  'archive_contractor',
  'Archive or restore a contractor',
  {
    contractor: z.string().describe('Contractor company name (partial) or ID'),
    archive: z.boolean().describe('true to archive, false to restore'),
  },
  async ({ contractor, archive }) => {
    const c = await resolveContractor(contractor)
    if (!c) return { content: [{ type: 'text', text: `Contractor "${contractor}" not found.` }] }

    const { error } = await supabase.from('contractors').update({ is_active: !archive }).eq('id', c.id)
    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
    return { content: [{ type: 'text', text: `Contractor "${c.company_name}" ${archive ? 'archived' : 'restored'}.` }] }
  },
)

// ─── MAINTENANCE ITEMS ───────────────────────────────────────────────────────

server.tool(
  'get_open_items',
  'List all open (not complete) maintenance items for a project by name',
  {
    project: z.string().describe('Project name (partial match)'),
    status: z.enum(['logged', 'assigned', 'in_progress', 'contractor_complete']).optional(),
  },
  async ({ project, status }) => {
    const proj = await resolveProject(project)
    if (!proj) return { content: [{ type: 'text', text: 'Project not found.' }] }

    const unitIds = await unitIdsForProject(proj.id)
    if (!unitIds.length) return { content: [{ type: 'text', text: `${proj.name} has no units.` }] }

    let query = supabase
      .from('maintenance_items')
      .select('item_number, title, status, priority, created_at, unit:units(unit_identifier)')
      .in('unit_id', unitIds)
      .not('status', 'in', '("complete","cancelled")')
      .order('item_number')

    if (status) query = query.eq('status', status)

    const { data, error } = await query
    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
    if (!data?.length) return { content: [{ type: 'text', text: `No open items for ${proj.name}.` }] }

    const text = data.map(i => {
      const unit = (i.unit as any)?.unit_identifier ?? '?'
      const age = Math.floor((Date.now() - new Date(i.created_at).getTime()) / 86400000)
      return `[${i.item_number}] ${i.title} | ${i.status} | ${i.priority} | Unit ${unit} | ${age}d old`
    }).join('\n')

    return { content: [{ type: 'text', text: `Open items for ${proj.name}:\n\n${text}` }] }
  },
)

server.tool(
  'list_maintenance_items',
  'List maintenance items with optional filters',
  {
    status: z.enum(['logged', 'assigned', 'in_progress', 'contractor_complete', 'complete', 'all']).optional(),
    project: z.string().optional().describe('Project name (partial) or project ID'),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
    limit: z.number().min(1).max(100).optional().describe('Max results (default 20)'),
  },
  async ({ status, project, priority, limit = 20 }) => {
    let query = supabase
      .from('maintenance_items')
      .select('item_number, title, status, priority, created_at, unit:units(unit_identifier, project:projects(name))')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (status && status !== 'all') query = query.eq('status', status)
    if (priority) query = query.eq('priority', priority)

    if (project) {
      const proj = await resolveProjectAny(project)
      if (proj) {
        const unitIds = await unitIdsForProject(proj.id)
        if (unitIds.length) query = query.in('unit_id', unitIds)
      }
    }

    const { data, error } = await query
    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }

    const text = data.map(i => {
      const unit = i.unit as any
      return `[${i.item_number}] ${i.title} | ${i.status} | ${i.priority} | ${(unit?.project as any)?.name ?? '?'} · Construction No. ${unit?.unit_identifier ?? '?'}`
    }).join('\n')

    return { content: [{ type: 'text', text: text || 'No items found.' }] }
  },
)

server.tool(
  'get_maintenance_item',
  'Get full details for a maintenance item including activity log and comments',
  { item_number: z.string().describe('Item number e.g. "MH-0042"') },
  async ({ item_number }) => {
    const { data: item, error } = await supabase
      .from('maintenance_items')
      .select(`
        *,
        unit:units(unit_identifier, lot_number, address, owner_name, owner_phone, owner_email, project:projects(name)),
        trade:trades(name),
        contractor:contractors(company_name, email, phone),
        work_order:work_orders(work_order_number)
      `)
      .eq('item_number', item_number)
      .single()

    if (error || !item) return { content: [{ type: 'text', text: `Item ${item_number} not found.` }] }

    const { data: comments } = await supabase
      .from('contractor_comments')
      .select('author, content, created_at')
      .eq('maintenance_item_id', item.id)
      .order('created_at')

    const { data: activity } = await supabase
      .from('activity_log')
      .select('action, details, performed_by, created_at')
      .eq('maintenance_item_id', item.id)
      .order('created_at', { ascending: false })
      .limit(20)

    const u = item.unit as any
    const lines = [
      `[${item.item_number}] ${item.title}`,
      `Status: ${item.status} | Priority: ${item.priority}`,
      `Project: ${(u?.project as any)?.name ?? '—'}`,
      `Unit: Construction No. ${u?.unit_identifier ?? '—'} | Lot ${u?.lot_number ?? '—'}`,
      `Address: ${u?.address ?? '—'}`,
      `Owner: ${u?.owner_name ?? '—'} | ${u?.owner_phone ?? '—'} | ${u?.owner_email ?? '—'}`,
      `Trade: ${(item.trade as any)?.name ?? '—'}`,
      `Contractor: ${(item.contractor as any)?.company_name ?? '—'}`,
      `Work Order: ${(item.work_order as any)?.work_order_number ?? '—'}`,
      `Scheduled date: ${item.scheduled_date ?? '—'}`,
      `Created: ${new Date(item.created_at).toLocaleDateString('en-NZ')}`,
      item.completed_at ? `Completed: ${new Date(item.completed_at).toLocaleDateString('en-NZ')}` : '',
      `Description: ${item.description ?? '—'}`,
      ``,
      `Comments (${comments?.length ?? 0}):`,
      ...(comments ?? []).map(c => `  [${new Date(c.created_at).toLocaleDateString('en-NZ')}] ${c.author}: ${c.content}`),
      ``,
      `Recent activity:`,
      ...(activity ?? []).map(a => `  [${new Date(a.created_at).toLocaleDateString('en-NZ')}] ${a.action} by ${a.performed_by}`),
    ].filter(l => l !== '')

    return { content: [{ type: 'text', text: lines.join('\n') }] }
  },
)

server.tool(
  'create_maintenance_item',
  'Create a new maintenance item on a unit',
  {
    unit_id: z.string().describe('Unit ID (from list_units)'),
    title: z.string().describe('Short title of the issue'),
    description: z.string().optional(),
    priority: z.enum(['low', 'medium', 'high', 'urgent']),
    trade_id: z.string().optional().describe('Trade ID if known (from list_trades)'),
  },
  async ({ unit_id, title, description, priority, trade_id }) => {
    const { data, error } = await supabase
      .from('maintenance_items')
      .insert({ unit_id, title, description: description ?? null, priority, trade_id: trade_id ?? null })
      .select('item_number, title, status')
      .single()

    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
    return { content: [{ type: 'text', text: `Created ${data.item_number} — ${data.title} (${data.status})` }] }
  },
)

server.tool(
  'update_maintenance_item',
  'Edit a maintenance item\'s title, description, priority, or trade',
  {
    item_number: z.string().describe('Item number e.g. "MH-0042"'),
    title: z.string().optional(),
    description: z.string().optional(),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
    trade_id: z.string().optional().describe('Trade ID (from list_trades), or empty string to clear'),
  },
  async ({ item_number, title, description, priority, trade_id }) => {
    const item = await resolveItemByNumber(item_number)
    if (!item) return { content: [{ type: 'text', text: `Item ${item_number} not found.` }] }

    const updates: Record<string, unknown> = {}
    if (title !== undefined) updates.title = title
    if (description !== undefined) updates.description = description
    if (priority !== undefined) updates.priority = priority
    if (trade_id !== undefined) updates.trade_id = trade_id === '' ? null : trade_id

    const { error } = await supabase.from('maintenance_items').update(updates).eq('id', item.id)
    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
    return { content: [{ type: 'text', text: `${item_number} updated.` }] }
  },
)

server.tool(
  'update_item_status',
  'Update the status of a maintenance item',
  {
    item_number: z.string().describe('Item number e.g. "MH-0042"'),
    status: z.enum(['logged', 'assigned', 'in_progress', 'contractor_complete', 'complete', 'cancelled']),
    note: z.string().optional().describe('Optional note to add alongside the status change'),
  },
  async ({ item_number, status, note }) => {
    const item = await resolveItemByNumber(item_number)
    if (!item) return { content: [{ type: 'text', text: `Item ${item_number} not found.` }] }

    const update: Record<string, unknown> = { status }
    if (status === 'complete') update.completed_at = new Date().toISOString()

    const { error } = await supabase.from('maintenance_items').update(update).eq('id', item.id)
    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }

    await logActivity(item.id, `Status changed to ${status}`, { previous_status: item.status })

    if (note) {
      await supabase.from('contractor_comments').insert({
        maintenance_item_id: item.id,
        author: 'Admin',
        content: note,
      })
    }

    return { content: [{ type: 'text', text: `${item_number} updated to "${status}".${note ? ' Note added.' : ''}` }] }
  },
)

server.tool(
  'set_scheduled_date',
  'Set or clear the scheduled date on a maintenance item',
  {
    item_number: z.string().describe('Item number e.g. "MH-0042"'),
    date: z.string().optional().describe('ISO date e.g. "2025-08-15", omit to clear'),
  },
  async ({ item_number, date }) => {
    const item = await resolveItemByNumber(item_number)
    if (!item) return { content: [{ type: 'text', text: `Item ${item_number} not found.` }] }

    const { error } = await supabase
      .from('maintenance_items')
      .update({ scheduled_date: date ?? null })
      .eq('id', item.id)

    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
    return { content: [{ type: 'text', text: date ? `${item_number} scheduled for ${date}.` : `${item_number} scheduled date cleared.` }] }
  },
)

server.tool(
  'add_note',
  'Add a note/comment to a maintenance item',
  {
    item_number: z.string().describe('Item number e.g. "MH-0042"'),
    note: z.string().describe('Note content'),
    author: z.string().optional().describe('Author name (default: Admin)'),
  },
  async ({ item_number, note, author = 'Admin' }) => {
    const item = await resolveItemByNumber(item_number)
    if (!item) return { content: [{ type: 'text', text: `Item ${item_number} not found.` }] }

    const { error } = await supabase.from('contractor_comments').insert({
      maintenance_item_id: item.id,
      author,
      content: note,
    })
    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
    return { content: [{ type: 'text', text: `Note added to ${item_number}.` }] }
  },
)

server.tool(
  'assign_contractor',
  'Assign a contractor to a maintenance item',
  {
    item_number: z.string().describe('Item number e.g. "MH-0042"'),
    contractor: z.string().describe('Contractor company name (partial match)'),
  },
  async ({ item_number, contractor }) => {
    const item = await resolveItemByNumber(item_number)
    if (!item) return { content: [{ type: 'text', text: `Item ${item_number} not found.` }] }

    const c = await resolveContractor(contractor)
    if (!c) return { content: [{ type: 'text', text: `Contractor "${contractor}" not found.` }] }

    const { error } = await supabase
      .from('maintenance_items')
      .update({ contractor_id: c.id, status: 'assigned' })
      .eq('id', item.id)

    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
    await logActivity(item.id, `Contractor assigned: ${c.company_name}`)
    return { content: [{ type: 'text', text: `${item_number} assigned to ${c.company_name} (status → assigned).` }] }
  },
)

server.tool(
  'get_overdue_items',
  'List maintenance items open longer than the given number of days',
  {
    days: z.number().min(1).optional().describe('Days threshold (default 14)'),
    project: z.string().optional().describe('Filter by project name (partial)'),
  },
  async ({ days = 14, project }) => {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString()

    let unitIds: string[] | undefined
    if (project) {
      const proj = await resolveProject(project)
      if (!proj) return { content: [{ type: 'text', text: 'Project not found.' }] }
      unitIds = await unitIdsForProject(proj.id)
    }

    let query = supabase
      .from('maintenance_items')
      .select('item_number, title, status, priority, created_at, unit:units(unit_identifier, project:projects(name))')
      .in('status', ['logged', 'assigned', 'in_progress'])
      .lt('created_at', cutoff)
      .order('created_at')

    if (unitIds?.length) query = query.in('unit_id', unitIds)

    const { data, error } = await query
    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
    if (!data?.length) return { content: [{ type: 'text', text: `No items overdue by ${days} days.` }] }

    const text = data.map(i => {
      const unit = i.unit as any
      const age = Math.floor((Date.now() - new Date(i.created_at).getTime()) / 86400000)
      return `[${i.item_number}] ${i.title} | ${i.status} | ${i.priority} | ${(unit?.project as any)?.name ?? '?'} · Construction No. ${unit?.unit_identifier ?? '?'} | ${age}d`
    }).join('\n')

    return { content: [{ type: 'text', text: `Items overdue by >${days} days (${data.length}):\n\n${text}` }] }
  },
)

// ─── SIGN-OFF QUEUE ──────────────────────────────────────────────────────────

server.tool(
  'get_sign_off_queue',
  'List all items awaiting admin sign-off (status: contractor_complete)',
  {},
  async () => {
    const { data, error } = await supabase
      .from('maintenance_items')
      .select(`
        item_number, title, priority, updated_at,
        unit:units(unit_identifier, project:projects(name)),
        contractor:contractors(company_name)
      `)
      .eq('status', 'contractor_complete')
      .order('updated_at')

    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
    if (!data?.length) return { content: [{ type: 'text', text: 'Sign-off queue is empty.' }] }

    const text = data.map(i => {
      const unit = i.unit as any
      const age = Math.floor((Date.now() - new Date(i.updated_at).getTime()) / 86400000)
      return `[${i.item_number}] ${i.title} | ${i.priority} | ${(unit?.project as any)?.name ?? '?'} · ${unit?.unit_identifier ?? '?'} | ${(i.contractor as any)?.company_name ?? '—'} | waiting ${age}d`
    }).join('\n')

    return { content: [{ type: 'text', text: `Sign-off queue (${data.length}):\n\n${text}` }] }
  },
)

server.tool(
  'confirm_sign_off',
  'Confirm a contractor-complete item as fully complete',
  {
    item_number: z.string().describe('Item number e.g. "MH-0042"'),
  },
  async ({ item_number }) => {
    const item = await resolveItemByNumber(item_number)
    if (!item) return { content: [{ type: 'text', text: `Item ${item_number} not found.` }] }

    if (item.status !== 'contractor_complete')
      return { content: [{ type: 'text', text: `${item_number} is not in "contractor_complete" status (current: ${item.status}).` }] }

    const { error } = await supabase
      .from('maintenance_items')
      .update({ status: 'complete', completed_at: new Date().toISOString() })
      .eq('id', item.id)

    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
    await logActivity(item.id, 'Confirmed complete', { previous_status: 'contractor_complete' })
    return { content: [{ type: 'text', text: `${item_number} confirmed as complete.` }] }
  },
)

server.tool(
  'send_back_item',
  'Send a contractor-complete item back to in_progress with an optional note',
  {
    item_number: z.string().describe('Item number e.g. "MH-0042"'),
    note: z.string().optional().describe('Reason for sending back'),
  },
  async ({ item_number, note }) => {
    const item = await resolveItemByNumber(item_number)
    if (!item) return { content: [{ type: 'text', text: `Item ${item_number} not found.` }] }

    const { error } = await supabase
      .from('maintenance_items')
      .update({ status: 'in_progress' })
      .eq('id', item.id)

    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }

    await logActivity(item.id, 'Sent back to in_progress', { previous_status: item.status })

    if (note) {
      await supabase.from('contractor_comments').insert({
        maintenance_item_id: item.id,
        author: 'Admin',
        content: note,
      })
    }

    return { content: [{ type: 'text', text: `${item_number} sent back to in_progress.${note ? ' Note added.' : ''}` }] }
  },
)

// ─── WORK ORDERS ─────────────────────────────────────────────────────────────

server.tool(
  'list_work_orders',
  'List work orders with status and assigned contractor',
  {
    status: z.enum(['draft', 'sent', 'in_progress', 'complete', 'all']).optional(),
    project: z.string().optional().describe('Filter by project name (partial) or ID'),
    limit: z.number().min(1).max(50).optional().describe('Default 10'),
  },
  async ({ status, project, limit = 10 }) => {
    let query = supabase
      .from('work_orders')
      .select('id, work_order_number, status, sent_at, notes, project:projects(name), contractor:contractors(company_name)')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (status && status !== 'all') query = query.eq('status', status)

    if (project) {
      const proj = await resolveProjectAny(project)
      if (proj) query = query.eq('project_id', proj.id)
    }

    const { data, error } = await query
    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }

    const text = data.map(wo => {
      const sentDate = wo.sent_at ? new Date(wo.sent_at).toLocaleDateString('en-NZ') : '—'
      return `[${wo.work_order_number}] ${(wo.project as any)?.name ?? '?'} → ${(wo.contractor as any)?.company_name ?? '?'} | ${wo.status} | sent: ${sentDate} [id: ${wo.id}]`
    }).join('\n')

    return { content: [{ type: 'text', text: text || 'No work orders found.' }] }
  },
)

server.tool(
  'get_work_order',
  'Get full details for a work order including all items',
  { work_order_number: z.string().describe('Work order number e.g. "WO-0003"') },
  async ({ work_order_number }) => {
    const { data: wo, error } = await supabase
      .from('work_orders')
      .select('*, project:projects(name), contractor:contractors(company_name, email, phone)')
      .eq('work_order_number', work_order_number)
      .single()

    if (error || !wo) return { content: [{ type: 'text', text: `Work order ${work_order_number} not found.` }] }

    const { data: items } = await supabase
      .from('maintenance_items')
      .select('item_number, title, status, priority, unit:units(unit_identifier, address, owner_name, owner_phone), trade:trades(name)')
      .eq('work_order_id', wo.id)
      .order('item_number')

    const lines = [
      `Work Order: ${wo.work_order_number}`,
      `Project: ${(wo.project as any)?.name ?? '—'}`,
      `Contractor: ${(wo.contractor as any)?.company_name ?? '—'} | ${(wo.contractor as any)?.email ?? '—'}`,
      `Status: ${wo.status}`,
      `Sent: ${wo.sent_at ? new Date(wo.sent_at).toLocaleDateString('en-NZ') : 'Not sent'}`,
      `Notes: ${wo.notes ?? '—'}`,
      ``,
      `Items (${items?.length ?? 0}):`,
      ...(items ?? []).map(i => {
        const u = i.unit as any
        return `  [${i.item_number}] ${i.title} | ${i.status} | ${i.priority} | Unit ${u?.unit_identifier ?? '?'} — ${u?.address ?? '—'} | ${u?.owner_name ?? '—'} ${u?.owner_phone ?? ''}`
      }),
    ]

    return { content: [{ type: 'text', text: lines.join('\n') }] }
  },
)

server.tool(
  'create_work_order',
  'Create a new work order grouping maintenance items for a contractor',
  {
    project: z.string().describe('Project name (partial) or ID'),
    contractor: z.string().describe('Contractor company name (partial) or ID'),
    item_numbers: z.array(z.string()).describe('Item numbers to include e.g. ["MH-0001","MH-0005"]'),
    notes: z.string().optional(),
  },
  async ({ project, contractor, item_numbers, notes }) => {
    const proj = await resolveProjectAny(project)
    if (!proj) return { content: [{ type: 'text', text: 'Project not found.' }] }

    const c = await resolveContractor(contractor)
    if (!c) return { content: [{ type: 'text', text: `Contractor "${contractor}" not found.` }] }

    const { data: wo, error: woErr } = await supabase
      .from('work_orders')
      .insert({ project_id: proj.id, contractor_id: c.id, notes: notes ?? null })
      .select('id, work_order_number')
      .single()

    if (woErr) return { content: [{ type: 'text', text: `Error creating work order: ${woErr.message}` }] }

    const items = await Promise.all(item_numbers.map(n => resolveItemByNumber(n)))
    const validIds = items.filter(Boolean).map(i => i!.id)

    if (validIds.length) {
      const { error: linkErr } = await supabase
        .from('maintenance_items')
        .update({ work_order_id: wo.id })
        .in('id', validIds)

      if (linkErr) return { content: [{ type: 'text', text: `Work order ${wo.work_order_number} created but failed to link items: ${linkErr.message}` }] }
    }

    const missed = item_numbers.length - validIds.length
    return {
      content: [{
        type: 'text',
        text: `Work order ${wo.work_order_number} created with ${validIds.length} item(s).${missed ? ` (${missed} item number(s) not found)` : ''}`
      }]
    }
  },
)

server.tool(
  'update_work_order',
  'Update work order notes or status',
  {
    work_order_number: z.string().describe('Work order number e.g. "WO-0003"'),
    notes: z.string().optional(),
    status: z.enum(['draft', 'sent', 'in_progress', 'complete']).optional(),
  },
  async ({ work_order_number, notes, status }) => {
    const { data: wo } = await supabase
      .from('work_orders')
      .select('id')
      .eq('work_order_number', work_order_number)
      .single()

    if (!wo) return { content: [{ type: 'text', text: `Work order ${work_order_number} not found.` }] }

    const updates: Record<string, unknown> = {}
    if (notes !== undefined) updates.notes = notes
    if (status !== undefined) updates.status = status

    const { error } = await supabase.from('work_orders').update(updates).eq('id', wo.id)
    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
    return { content: [{ type: 'text', text: `Work order ${work_order_number} updated.` }] }
  },
)

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main()
