#!/usr/bin/env npx tsx
/**
 * Maintenance Hub MCP Server
 * Run: npx tsx mcp-server.ts
 * Add to Claude Desktop config:
 *   { "command": "npx", "args": ["tsx", "/path/to/mcp-server.ts"] }
 */
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

const server = new McpServer({
  name: 'maintenance-hub',
  version: '1.0.0',
})

server.tool(
  'list_projects',
  'List all active projects with their unit counts',
  {},
  async () => {
    const { data, error } = await supabase
      .from('projects')
      .select('id, name, address, status')
      .eq('status', 'active')
      .order('name')

    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }

    const text = data.map(p => `• ${p.name} (${p.address ?? 'no address'}) [id: ${p.id}]`).join('\n')
    return { content: [{ type: 'text', text: text || 'No active projects.' }] }
  },
)

server.tool(
  'list_maintenance_items',
  'List maintenance items with optional filters',
  {
    status: z.enum(['logged', 'assigned', 'in_progress', 'contractor_complete', 'complete', 'all']).optional().describe('Filter by status'),
    project_id: z.string().optional().describe('Filter by project ID'),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional().describe('Filter by priority'),
    limit: z.number().min(1).max(100).optional().describe('Max results (default 20)'),
  },
  async ({ status, project_id, priority, limit = 20 }) => {
    let query = supabase
      .from('maintenance_items')
      .select('item_number, title, status, priority, created_at, unit:units(unit_identifier, address, project:projects(name))')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (status && status !== 'all') query = query.eq('status', status)
    if (priority) query = query.eq('priority', priority)
    if (project_id) {
      const { data: units } = await supabase.from('units').select('id').eq('project_id', project_id)
      const unitIds = units?.map(u => u.id) ?? []
      if (unitIds.length > 0) query = query.in('unit_id', unitIds)
    }

    const { data, error } = await query
    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }

    const text = data.map(i => {
      const unit = i.unit as any
      const project = unit?.project as any
      return `[${i.item_number}] ${i.title} | ${i.status} | ${i.priority} | ${project?.name ?? '?'} · ${unit?.unit_identifier ?? '?'}`
    }).join('\n')

    return { content: [{ type: 'text', text: text || 'No items found.' }] }
  },
)

server.tool(
  'get_project_status',
  'Get a summary of a project: item counts by status, overdue items, contractors assigned',
  {
    project_id: z.string().describe('Project ID (from list_projects)'),
  },
  async ({ project_id }) => {
    const { data: project } = await supabase.from('projects').select('name, address').eq('id', project_id).single()
    if (!project) return { content: [{ type: 'text', text: 'Project not found.' }] }

    const { data: units } = await supabase.from('units').select('id').eq('project_id', project_id)
    const unitIds = units?.map(u => u.id) ?? []

    if (unitIds.length === 0) {
      return { content: [{ type: 'text', text: `${project.name} has no units.` }] }
    }

    const { data: items } = await supabase
      .from('maintenance_items')
      .select('status, priority, created_at')
      .in('unit_id', unitIds)

    if (!items?.length) {
      return { content: [{ type: 'text', text: `${project.name} — no maintenance items.` }] }
    }

    const byStatus = (s: string) => items.filter(i => i.status === s).length
    const overdue = items.filter(i =>
      ['logged', 'assigned', 'in_progress'].includes(i.status) &&
      new Date(i.created_at) < new Date(Date.now() - 14 * 86400000)
    ).length

    const lines = [
      `Project: ${project.name} (${project.address ?? 'no address'})`,
      `Total items: ${items.length}`,
      ``,
      `By status:`,
      `  Logged:               ${byStatus('logged')}`,
      `  Assigned:             ${byStatus('assigned')}`,
      `  In progress:          ${byStatus('in_progress')}`,
      `  Contractor complete:  ${byStatus('contractor_complete')}`,
      `  Complete:             ${byStatus('complete')}`,
      ``,
      `Overdue (>14 days open): ${overdue}`,
    ]

    return { content: [{ type: 'text', text: lines.join('\n') }] }
  },
)

server.tool(
  'create_maintenance_item',
  'Create a new maintenance item',
  {
    unit_id: z.string().describe('Unit ID to attach the item to'),
    title: z.string().describe('Short title of the issue'),
    description: z.string().optional().describe('Detailed description'),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).describe('Priority level'),
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
  'List work orders with their status and item counts',
  {
    status: z.enum(['draft', 'sent', 'in_progress', 'complete', 'all']).optional().describe('Filter by status'),
    limit: z.number().min(1).max(50).optional().describe('Max results (default 10)'),
  },
  async ({ status, limit = 10 }) => {
    let query = supabase
      .from('work_orders')
      .select('work_order_number, status, sent_at, notes, project:projects(name), contractor:contractors(company_name)')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (status && status !== 'all') query = query.eq('status', status)

    const { data, error } = await query
    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }

    const text = data.map(wo => {
      const project = wo.project as any
      const contractor = wo.contractor as any
      const sentDate = wo.sent_at ? new Date(wo.sent_at).toLocaleDateString('en-NZ') : '—'
      return `[${wo.work_order_number}] ${project?.name ?? '?'} → ${contractor?.company_name ?? '?'} | ${wo.status} | sent: ${sentDate}`
    }).join('\n')

    return { content: [{ type: 'text', text: text || 'No work orders found.' }] }
  },
)

server.tool(
  'list_units',
  'List units for a project',
  {
    project_id: z.string().describe('Project ID'),
  },
  async ({ project_id }) => {
    const { data, error } = await supabase
      .from('units')
      .select('id, unit_identifier, address, owner_name')
      .eq('project_id', project_id)
      .order('unit_identifier')

    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }

    const text = data.map(u =>
      `[${u.id}] ${u.unit_identifier}${u.address ? ` — ${u.address}` : ''}${u.owner_name ? ` (${u.owner_name})` : ''}`
    ).join('\n')

    return { content: [{ type: 'text', text: text || 'No units found.' }] }
  },
)

const transport = new StdioServerTransport()
await server.connect(transport)
