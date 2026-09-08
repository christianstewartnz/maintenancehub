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

const server = new McpServer({ name: 'maintenance-hub', version: '2.0.0' })

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

// ─── tools ──────────────────────────────────────────────────────────────────

server.tool('list_projects', 'List all active projects', {}, async () => {
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, address, status')
    .eq('status', 'active')
    .order('name')

  if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
  const text = data.map(p => `• ${p.name} (${p.address ?? 'no address'}) [id: ${p.id}]`).join('\n')
  return { content: [{ type: 'text', text: text || 'No active projects.' }] }
})

server.tool(
  'get_project_status',
  'Summary of a project: item counts by status and overdue count. Accepts project name (partial match) or project ID.',
  { project: z.string().describe('Project name (partial match) or project ID') },
  async ({ project }) => {
    const isUuid = /^[0-9a-f-]{36}$/.test(project)
    const proj = isUuid
      ? (await supabase.from('projects').select('id, name, address').eq('id', project).single()).data
      : await resolveProject(project)

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

server.tool(
  'get_open_items',
  'List all open (not complete) maintenance items for a project by name',
  {
    project: z.string().describe('Project name (partial match)'),
    status: z.enum(['logged', 'assigned', 'in_progress', 'contractor_complete']).optional().describe('Filter to a specific open status'),
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
      const isUuid = /^[0-9a-f-]{36}$/.test(project)
      const proj = isUuid
        ? (await supabase.from('projects').select('id').eq('id', project).single()).data
        : await resolveProject(project)
      if (proj) {
        const unitIds = await unitIdsForProject(proj.id)
        if (unitIds.length) query = query.in('unit_id', unitIds)
      }
    }

    const { data, error } = await query
    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }

    const text = data.map(i => {
      const unit = i.unit as any
      return `[${i.item_number}] ${i.title} | ${i.status} | ${i.priority} | ${(unit?.project as any)?.name ?? '?'} · Unit ${unit?.unit_identifier ?? '?'}`
    }).join('\n')

    return { content: [{ type: 'text', text: text || 'No items found.' }] }
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

    const { data: c } = await supabase
      .from('contractors')
      .select('id, company_name')
      .ilike('company_name', `%${contractor}%`)
      .eq('is_active', true)
      .limit(1)
      .single()

    if (!c) return { content: [{ type: 'text', text: `Contractor "${contractor}" not found.` }] }

    const { error } = await supabase
      .from('maintenance_items')
      .update({ contractor_id: c.id, status: 'assigned' })
      .eq('id', item.id)

    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
    return { content: [{ type: 'text', text: `${item_number} assigned to ${c.company_name} (status → assigned).` }] }
  },
)

server.tool(
  'get_overdue_items',
  'List maintenance items that have been open for longer than the given number of days',
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
      return `[${i.item_number}] ${i.title} | ${i.status} | ${i.priority} | ${(unit?.project as any)?.name ?? '?'} · Unit ${unit?.unit_identifier ?? '?'} | ${age}d`
    }).join('\n')

    return { content: [{ type: 'text', text: `Items overdue by >${days} days (${data.length}):\n\n${text}` }] }
  },
)

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
  'list_units',
  'List units for a project',
  { project: z.string().describe('Project name (partial) or project ID') },
  async ({ project }) => {
    const isUuid = /^[0-9a-f-]{36}$/.test(project)
    const proj = isUuid
      ? (await supabase.from('projects').select('id, name').eq('id', project).single()).data
      : await resolveProject(project)

    if (!proj) return { content: [{ type: 'text', text: 'Project not found.' }] }

    const { data, error } = await supabase
      .from('units')
      .select('id, unit_identifier, address, owner_name')
      .eq('project_id', proj.id)
      .order('unit_identifier')

    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
    const text = data.map(u =>
      `[${u.id}] ${u.unit_identifier}${u.address ? ` — ${u.address}` : ''}${u.owner_name ? ` (${u.owner_name})` : ''}`
    ).join('\n')
    return { content: [{ type: 'text', text: `Units for ${proj.name}:\n\n${text || 'No units.'}` }] }
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
    trade_id: z.string().optional().describe('Trade ID if known'),
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
  'list_work_orders',
  'List work orders with status and assigned contractor',
  {
    status: z.enum(['draft', 'sent', 'in_progress', 'complete', 'all']).optional(),
    limit: z.number().min(1).max(50).optional().describe('Default 10'),
  },
  async ({ status, limit = 10 }) => {
    let query = supabase
      .from('work_orders')
      .select('work_order_number, status, sent_at, project:projects(name), contractor:contractors(company_name)')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (status && status !== 'all') query = query.eq('status', status)

    const { data, error } = await query
    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }

    const text = data.map(wo => {
      const sentDate = wo.sent_at ? new Date(wo.sent_at).toLocaleDateString('en-NZ') : '—'
      return `[${wo.work_order_number}] ${(wo.project as any)?.name ?? '?'} → ${(wo.contractor as any)?.company_name ?? '?'} | ${wo.status} | sent: ${sentDate}`
    }).join('\n')

    return { content: [{ type: 'text', text: text || 'No work orders found.' }] }
  },
)

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main()
