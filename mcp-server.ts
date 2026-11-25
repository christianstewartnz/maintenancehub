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

type UnitLike = { unit_identifier?: string | null; address?: string | null } | null | undefined

/**
 * Canonical unit reference — same semantics as formatUnitLabel in lib/utils.ts
 * (kept local so this standalone server doesn't pull in the Next app's deps).
 * Always shows BOTH the unit number and the street address when present
 * (e.g. "A12 · 5 Smith St"); some projects (e.g. Karori) have no unit numbers,
 * so the address alone is used.
 */
function unitLabel(unit: UnitLike, fallback = '—', separator = ' · '): string {
  const id = unit?.unit_identifier?.trim()
  const addr = unit?.address?.trim()
  if (id && addr) return `${id}${separator}${addr}`
  return id || addr || fallback
}

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
    .select('id, item_number, title, status, has_steps, parent_item_id, unit_id')
    .eq('item_number', itemNumber.trim().toUpperCase())
    .single()
  return data
}

/** The contractor assigned to this trade on its project (project_trade_assignments), if any. */
async function defaultContractorForTrade(tradeId: string): Promise<string | null> {
  const { data: t } = await supabase.from('trades').select('project_id').eq('id', tradeId).maybeSingle()
  if (!t) return null
  const { data } = await supabase
    .from('project_trade_assignments')
    .select('contractor_id')
    .eq('project_id', t.project_id)
    .eq('trade_id', tradeId)
    .limit(1)
    .maybeSingle()
  return data?.contractor_id ?? null
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
      .select('status, created_at')
      .in('unit_id', unitIds)
      .is('archived_at', null)

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
  'List units for a project, showing each unit\'s unit number (construction no.) and street address. Optionally filter by unit number, street address or lot number (partial match) — use the address for projects without unit numbers (e.g. Karori).',
  {
    project: z.string().describe('Project name (partial) or project ID'),
    search: z.string().optional().describe('Optional filter: unit number, street address or lot number (partial match)'),
  },
  async ({ project, search }) => {
    const proj = await resolveProjectAny(project)
    if (!proj) return { content: [{ type: 'text', text: 'Project not found.' }] }

    const { data, error } = await supabase
      .from('units')
      .select('id, unit_identifier, lot_number, address, settlement_date, maintenance_reminder_sent_at, owners:unit_owners(id, name, email, phone)')
      .eq('project_id', proj.id)
      .order('lot_number', { ascending: true })

    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
    const q = search?.trim().toLowerCase()
    const rows = q
      ? data.filter((u: any) =>
          [u.unit_identifier, u.address, u.lot_number].some((v: unknown) => v != null && String(v).toLowerCase().includes(q)))
      : data
    const text = rows.map((u: any) => {
      const ownerNames = u.owners?.map((o: any) => o.name).join(', ')
      return `[${u.id}] Unit: ${unitLabel(u)}${u.lot_number ? ` | Lot ${u.lot_number}` : ''}${ownerNames ? ` | ${ownerNames}` : ''}${u.settlement_date ? ` | settled ${u.settlement_date}` : ''}${u.maintenance_reminder_sent_at ? ` | 90-day reminder sent ${String(u.maintenance_reminder_sent_at).slice(0, 10)}` : ''}`
    }).join('\n')
    const empty = q ? `No units matching "${search}".` : 'No units.'
    return { content: [{ type: 'text', text: `Units for ${proj.name}:\n\n${text || empty}` }] }
  },
)

server.tool(
  'get_unit',
  'Get full details for a single unit by ID (unit number, street address, owners, access contact). Use list_units with search to find a unit by unit number or address.',
  { unit_id: z.string().describe('Unit ID (from list_units)') },
  async ({ unit_id }) => {
    const { data, error } = await supabase
      .from('units')
      .select('*, project:projects(name), owners:unit_owners(id, name, email, phone)')
      .eq('id', unit_id)
      .single()

    if (error || !data) return { content: [{ type: 'text', text: 'Unit not found.' }] }

    const owners = (data as any).owners ?? []
    const ownerLines = owners.length
      ? owners.map((o: any) => `  [${o.id}] ${o.name}${o.email ? ` | ${o.email}` : ''}${o.phone ? ` | ${o.phone}` : ''}`).join('\n')
      : '  (none)'
    const lines = [
      `Project: ${(data as any).project?.name ?? '?'}`,
      `Unit: ${unitLabel(data)}`,
      `Construction No.: ${data.unit_identifier ?? '—'}`,
      `Lot number: ${data.lot_number ?? '—'}`,
      `Address: ${data.address ?? '—'}`,
      `Owners:\n${ownerLines}`,
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
    unit_identifier: z.string().optional().describe('Construction number / unit identifier'),
    lot_number: z.string().optional(),
    address: z.string().optional(),
    access_contact_name: z.string().optional(),
    access_contact_email: z.string().optional(),
    access_contact_phone: z.string().optional(),
    settlement_date: z.string().optional().describe('ISO date string e.g. 2025-06-01'),
    notes: z.string().optional(),
  },
  async ({ project, ...fields }) => {
    const proj = await resolveProjectAny(project)
    if (!proj) return { content: [{ type: 'text', text: 'Project not found.' }] }

    const { data, error } = await supabase
      .from('units')
      .insert({ project_id: proj.id, ...fields })
      .select('id, unit_identifier, lot_number, address')
      .single()

    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
    return { content: [{ type: 'text', text: `Unit created [id: ${data.id}] ${unitLabel(data, '(no unit number or address)')}${data.lot_number ? ` | Lot ${data.lot_number}` : ''}` }] }
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
    access_contact_name: z.string().optional(),
    access_contact_email: z.string().optional(),
    access_contact_phone: z.string().optional(),
    settlement_date: z.string().optional().describe('ISO date string e.g. 2025-06-01, or empty string to clear'),
    maintenance_reminder_sent_at: z.string().optional().describe('Date the owners were sent their 90-day maintenance reminder (ISO e.g. 2026-11-16), or empty string to clear'),
    notes: z.string().optional(),
  },
  async ({ unit_id, ...fields }) => {
    const updates: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(fields)) {
      if (v !== undefined) updates[k] = v === '' ? null : v
    }

    const { data, error } = await supabase.from('units').update(updates).eq('id', unit_id).select('unit_identifier, address').maybeSingle()
    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
    if (!data) return { content: [{ type: 'text', text: 'Unit not found.' }] }
    return { content: [{ type: 'text', text: `Unit ${unitLabel(data, unit_id)} updated [id: ${unit_id}].` }] }
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

server.tool(
  'mark_maintenance_reminder_sent',
  'Record that the owners of one or more units were emailed their 90-day maintenance form reminder. Pass the recipient email addresses from the reminder email; every unit with an owner whose email matches is marked (so the unit\'s Maint. Due date shows green / "Reminded" in the app). Units already marked keep their earliest reminder date unless overwrite is true.',
  {
    owner_emails: z.array(z.string()).min(1).describe('Recipient email addresses (To/CC/BCC) of the reminder email'),
    sent_at: z.string().describe('Date the reminder was sent, ISO e.g. 2026-11-16'),
    project: z.string().optional().describe('Optional project name (partial) to restrict matching, e.g. "Karori"'),
    overwrite: z.boolean().optional().describe('Replace an existing reminder date (default false)'),
    dry_run: z.boolean().optional().describe('Report matches without changing anything'),
  },
  async ({ owner_emails, sent_at, project, overwrite, dry_run }) => {
    const emails = [...new Set(owner_emails.map(e => e.trim().toLowerCase()).filter(Boolean))]
    let projectId: string | null = null
    if (project) {
      const proj = await resolveProjectAny(project)
      if (!proj) return { content: [{ type: 'text', text: `Project "${project}" not found.` }] }
      projectId = proj.id
    }

    const { data: owners, error } = await supabase
      .from('unit_owners')
      .select('email, unit:units(id, project_id, unit_identifier, address, settlement_date, maintenance_reminder_sent_at, project:projects(name))')
      .not('email', 'is', null)
    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }

    const matched = new Map<string, any>()
    const matchedEmails = new Set<string>()
    for (const o of owners ?? []) {
      const ownerEmails = String(o.email).toLowerCase().split(/[;,\s]+/).filter(Boolean)
      const hit = ownerEmails.find(e => emails.includes(e))
      const unit = o.unit as any
      if (!hit || !unit) continue
      if (projectId && unit.project_id !== projectId) continue
      matchedEmails.add(hit)
      matched.set(unit.id, unit)
    }

    const lines: string[] = []
    let updated = 0
    for (const unit of matched.values()) {
      const label = `${unit.project?.name ?? '?'} — ${unitLabel(unit)}`
      if (unit.maintenance_reminder_sent_at && !overwrite) {
        lines.push(`• ${label}: already marked reminded ${String(unit.maintenance_reminder_sent_at).slice(0, 10)} (unchanged)`)
        continue
      }
      if (!dry_run) {
        const { error: upErr } = await supabase.from('units').update({ maintenance_reminder_sent_at: sent_at }).eq('id', unit.id)
        if (upErr) { lines.push(`• ${label}: ERROR ${upErr.message}`); continue }
      }
      updated++
      lines.push(`• ${label}: ${dry_run ? 'would mark' : 'marked'} reminded ${sent_at}`)
    }
    const unmatched = emails.filter(e => !matchedEmails.has(e))
    const summary = `${dry_run ? 'Dry run — ' : ''}${updated} unit(s) ${dry_run ? 'would be ' : ''}marked, ${matched.size - updated} already marked.`
    const tail = unmatched.length ? `\n\nNo unit owner found for: ${unmatched.join(', ')}` : ''
    return { content: [{ type: 'text', text: `${summary}\n${lines.join('\n')}${tail}` }] }
  },
)

// ─── UNIT OWNERS ─────────────────────────────────────────────────────────────

server.tool(
  'list_unit_owners',
  'List all owners for a unit',
  { unit_id: z.string().describe('Unit ID (from list_units or get_unit)') },
  async ({ unit_id }) => {
    const { data, error } = await supabase
      .from('unit_owners')
      .select('id, name, email, phone, created_at')
      .eq('unit_id', unit_id)
      .order('created_at')

    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
    if (!data?.length) return { content: [{ type: 'text', text: 'No owners for this unit.' }] }
    const text = data.map(o => `[${o.id}] ${o.name}${o.email ? ` | ${o.email}` : ''}${o.phone ? ` | ${o.phone}` : ''}`).join('\n')
    return { content: [{ type: 'text', text: text }] }
  },
)

server.tool(
  'add_unit_owner',
  'Add an owner to a unit. Use get_unit or list_units to find the unit_id first.',
  {
    unit_id: z.string().describe('Unit ID (from list_units or get_unit)'),
    name: z.string().describe('Owner full name'),
    email: z.string().optional().describe('Owner email'),
    phone: z.string().optional().describe('Owner phone'),
  },
  async ({ unit_id, name, email, phone }) => {
    const { data, error } = await supabase
      .from('unit_owners')
      .insert({ unit_id, name, email: email || null, phone: phone || null })
      .select('id, name')
      .single()

    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
    return { content: [{ type: 'text', text: `Owner "${data.name}" added [id: ${data.id}]` }] }
  },
)

server.tool(
  'remove_unit_owner',
  'Remove an owner from a unit',
  { owner_id: z.string().describe('Owner ID (from list_unit_owners or get_unit)') },
  async ({ owner_id }) => {
    const { error } = await supabase.from('unit_owners').delete().eq('id', owner_id)
    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
    return { content: [{ type: 'text', text: 'Owner removed.' }] }
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
      .select('item_number, title, status, portal_hidden, unit:units(unit_identifier, address, project:projects(name))')
      .eq('contractor_id', c.id)
      .is('archived_at', null)
      .not('status', 'in', '("complete","cancelled")')
      .order('item_number')

    const { data: recent } = await supabase
      .from('maintenance_items')
      .select('item_number, title, completed_at, unit:units(unit_identifier, address, project:projects(name))')
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
        return `  [${i.item_number}] ${i.title} | ${i.status} | ${(u?.project as any)?.name ?? '?'} | Unit ${unitLabel(u, '?')}${i.portal_hidden ? ' | HIDDEN from portal' : ''}`
      }),
      ``,
      `Recently completed (last 10):`,
      ...(recent ?? []).map(i => {
        const u = i.unit as any
        return `  [${i.item_number}] ${i.title} | ${(u?.project as any)?.name ?? '?'} | Unit ${unitLabel(u, '?')}`
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
      .select('item_number, title, status, created_at, portal_hidden, unit:units(unit_identifier, address)')
      .in('unit_id', unitIds)
      .is('archived_at', null)
      .not('status', 'in', '("complete","cancelled")')
      .order('item_number')

    if (status) query = query.eq('status', status)

    const { data, error } = await query
    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
    if (!data?.length) return { content: [{ type: 'text', text: `No open items for ${proj.name}.` }] }

    const text = data.map(i => {
      const unit = unitLabel(i.unit as any, '?')
      const age = Math.floor((Date.now() - new Date(i.created_at).getTime()) / 86400000)
      return `[${i.item_number}] ${i.title} | ${i.status} | Unit ${unit} | ${age}d old${i.portal_hidden ? ' | HIDDEN from portal' : ''}`
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
    limit: z.number().min(1).max(100).optional().describe('Max results (default 20)'),
    archived: z.boolean().optional().describe('true to list only archived items (default: archived items are excluded)'),
  },
  async ({ status, project, limit = 20, archived = false }) => {
    let query = supabase
      .from('maintenance_items')
      .select('item_number, title, status, created_at, portal_hidden, unit:units(unit_identifier, address, project:projects(name))')
      .order('created_at', { ascending: false })
      .limit(limit)

    query = archived ? query.not('archived_at', 'is', null) : query.is('archived_at', null)
    if (status && status !== 'all') query = query.eq('status', status)

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
      return `[${i.item_number}] ${i.title} | ${i.status} | ${(unit?.project as any)?.name ?? '?'} | Unit ${unitLabel(unit, '?')}${i.portal_hidden ? ' | HIDDEN from portal' : ''}`
    }).join('\n')

    return { content: [{ type: 'text', text: text || 'No items found.' }] }
  },
)

server.tool(
  'archive_maintenance_item',
  'Archive or restore a maintenance item. Archived items keep their history but are hidden from lists, counts, sign-off and the contractor portal.',
  {
    item_number: z.string().describe('Item number e.g. MI-0001'),
    archive: z.boolean().describe('true to archive, false to restore'),
  },
  async ({ item_number, archive }) => {
    const item = await resolveItemByNumber(item_number)
    if (!item) return { content: [{ type: 'text', text: `Item "${item_number}" not found.` }] }
    const { error } = await supabase
      .from('maintenance_items')
      .update({ archived_at: archive ? new Date().toISOString() : null })
      .eq('id', item.id)
    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
    await logActivity(item.id, archive ? 'item_archived' : 'item_restored')
    return { content: [{ type: 'text', text: `${item.item_number} — ${item.title} ${archive ? 'archived' : 'restored'}.` }] }
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
        unit:units(unit_identifier, lot_number, address, owners:unit_owners(id, name, email, phone), project:projects(name)),
        trade:trades(name),
        contractor:contractors(company_name, email, phone),
        work_order:work_orders(work_order_number),
        assignee:profiles!maintenance_items_assigned_to_fkey(full_name, email)
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

    // Steps: a job lists its steps; a step names its job
    const { data: steps } = await supabase
      .from('maintenance_items')
      .select('item_number, description, status, step_order, archived_at, trade:trades(name), contractor:contractors(company_name)')
      .eq('parent_item_id', item.parent_item_id ?? item.id)
      .order('step_order')
    const { data: parentItem } = item.parent_item_id
      ? await supabase.from('maintenance_items').select('item_number, title, description').eq('id', item.parent_item_id).single()
      : { data: null }
    const stepLines = (steps ?? []).filter(s => !s.archived_at).map((s, i) =>
      `  ${i + 1}. ${s.item_number} | ${(s.trade as any)?.name ?? 'no trade'} | ${(s.contractor as any)?.company_name ?? 'NO CONTRACTOR'} | ${s.status}${s.item_number === item.item_number ? '  <- this step' : ''}${s.description ? ` | ${s.description.split('\n')[0]}` : ' | (same instructions as job)'}`)

    const u = item.unit as any
    const lines = [
      ...(parentItem ? [`Step of job ${parentItem.item_number} — ${parentItem.title}`] : []),
      `[${item.item_number}] ${item.title}`,
      `Status: ${item.status}${item.archived_at ? ` (ARCHIVED ${new Date(item.archived_at).toLocaleDateString('en-NZ')})` : ''}`,
      `Project: ${(u?.project as any)?.name ?? '—'}`,
      `Unit: ${unitLabel(u)} | Lot ${u?.lot_number ?? '—'}`,
      `Construction No.: ${u?.unit_identifier ?? '—'}`,
      `Address: ${u?.address ?? '—'}`,
      u?.owners?.length ? `Owners: ${u.owners.map((o: any) => `${o.name}${o.phone ? ` (${o.phone})` : ''}${o.email ? ` <${o.email}>` : ''}`).join(', ')}` : 'Owner: —',
      `Trade: ${(item.trade as any)?.name ?? '—'}`,
      `Responsible (staff): ${item.assignee ? staffName(item.assignee as any) : 'No one'}`,
      `Contractor: ${(item.contractor as any)?.company_name ?? '—'}${item.portal_hidden ? ' (HIDDEN from their portal — set_portal_visibility to show)' : ''}`,
      `Work Order: ${(item.work_order as any)?.work_order_number ?? '—'}`,
      `Scheduled date: ${item.scheduled_date ?? '—'}`,
      `Created: ${new Date(item.created_at).toLocaleDateString('en-NZ')}`,
      item.completed_at ? `Completed: ${new Date(item.completed_at).toLocaleDateString('en-NZ')}` : '',
      `Description: ${item.description ?? (parentItem?.description ? `(same as job) ${parentItem.description}` : '—')}`,
      ...(stepLines.length ? [``, item.has_steps ? 'Steps (status follows these; the job has no contractor of its own):' : 'Steps on this job:', ...stepLines] : []),
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
  'Create a new maintenance item on a unit. Find the unit_id with list_units (search by unit number or street address). ' +
    'The title and description are CONTRACTOR-FACING (portal and Notify emails): keep them to the job only — what is wrong, where, and what needs doing — in 1–2 short plain sentences. ' +
    'Never put owner/tenant names, phone numbers, email addresses, "Logged from…"/"Source:" lines, email subjects or dates, follow-up history or the owner\'s backstory in them. ' +
    'When the item comes from an email, put all of that in source_note (plus the email_* fields) instead: it is saved as an internal email update contractors never see.',
  {
    unit_id: z.string().describe('Unit ID (from list_units — search by unit number or street address)'),
    title: z.string().describe('Short title in the style "Location - issue", e.g. "Stairwell divider - stripped screws"'),
    description: z.string().optional().describe('Contractor-facing job details only, e.g. "Divider on the stairwell has multiple stripped screws - replace the screws so the divider can be removed and refitted." No names, phone numbers, email references or dates.'),
    trade_id: z.string().optional().describe('Trade ID if known (from list_trades)'),
    hidden_from_portal: z.boolean().optional().describe('true to keep the item out of the contractor portal (and Notify emails) until shown, e.g. a list logged before the inspection. Default: shown.'),
    source_note: z.string().optional().describe('Internal only (never shown to contractors): where the item came from and any background, e.g. \'Logged from owner email "Minor issues 6/32 Kaihuia St" from Jan Holliday (027 707 0377), 9 Jun 2026, followed up 28 Sep 2026.\' Saved to the item\'s Email updates.'),
    email_message_id: z.string().optional().describe('Outlook message id of the source email, if any'),
    email_subject: z.string().optional(),
    email_from: z.string().optional(),
    email_to: z.string().optional(),
    email_date: z.string().optional().describe('ISO timestamp the source email was sent/received'),
  },
  async ({ unit_id, title, description, trade_id, hidden_from_portal, source_note, email_message_id, email_subject, email_from, email_to, email_date }) => {
    // Auto-assign the project's contractor for the trade, if it has one
    const contractorId = trade_id ? await defaultContractorForTrade(trade_id) : null
    const { data, error } = await supabase
      .from('maintenance_items')
      .insert({
        unit_id, title, description: description ?? null, trade_id: trade_id ?? null,
        portal_hidden: hidden_from_portal ?? false,
        // Stays Logged until the contractor is notified
        ...(contractorId ? { contractor_id: contractorId } : {}),
      })
      .select('item_number, title, status, portal_hidden, unit:units(unit_identifier, address), contractor:contractors(company_name)')
      .single()

    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
    const c = (data.contractor as any)?.company_name

    // Source details go to the internal Email updates, never the description
    let sourceLine = ''
    if (source_note?.trim()) {
      const { error: srcErr } = await supabase.rpc('apply_email_update', {
        p_item_number: data.item_number,
        p_note: source_note,
        p_new_status: null,
        p_contractor_email: null,
        p_email_message_id: email_message_id ?? null,
        p_email_subject: email_subject ?? null,
        p_email_from: email_from ?? null,
        p_email_to: email_to ?? null,
        p_email_date: email_date ?? null,
      })
      sourceLine = srcErr ? ` | Source note NOT saved: ${srcErr.message}` : ' | Source saved to Email updates'
    }
    return { content: [{ type: 'text', text: `Created ${data.item_number} — ${data.title} (${data.status})${c ? ` → ${c}` : ''} | Unit ${unitLabel(data.unit as any, '?')}${data.portal_hidden ? ' | HIDDEN from portal' : ''}${sourceLine}` }] }
  },
)

server.tool(
  'update_maintenance_item',
  'Edit a maintenance item\'s title, description, trade, or contractor-portal visibility. Title and description are contractor-facing: job details only, no owner names, phone numbers, email references or dates (use apply_email_update for those).',
  {
    item_number: z.string().describe('Item number e.g. "MH-0042"'),
    title: z.string().optional(),
    description: z.string().optional(),
    trade_id: z.string().optional().describe('Trade ID (from list_trades), or empty string to clear'),
    hidden_from_portal: z.boolean().optional().describe('true to hide from the contractor portal (and Notify emails), false to show again. A job split into steps applies it to its steps too.'),
  },
  async ({ item_number, title, description, trade_id, hidden_from_portal }) => {
    const item = await resolveItemByNumber(item_number)
    if (!item) return { content: [{ type: 'text', text: `Item ${item_number} not found.` }] }

    const updates: Record<string, unknown> = {}
    if (title !== undefined) updates.title = title
    if (description !== undefined) updates.description = description
    if (hidden_from_portal !== undefined) {
      updates.portal_hidden = hidden_from_portal
      if (item.has_steps) {
        const { error: stepErr } = await supabase.from('maintenance_items').update({ portal_hidden: hidden_from_portal }).eq('parent_item_id', item.id)
        if (stepErr) return { content: [{ type: 'text', text: `Error: ${stepErr.message}` }] }
      }
    }
    if (trade_id !== undefined) {
      if (item.has_steps) return { content: [{ type: 'text', text: `${item_number} is split into steps — set the trade on a step (see get_maintenance_item).` }] }
      updates.trade_id = trade_id === '' ? null : trade_id
    }

    // New trade: switch to the project's contractor for it, if it has one
    let contractorNote = ''
    if (trade_id) {
      const contractorId = await defaultContractorForTrade(trade_id)
      if (contractorId) {
        updates.contractor_id = contractorId
        const { data: c } = await supabase.from('contractors').select('company_name').eq('id', contractorId).single()
        contractorNote = ` Contractor set to ${c?.company_name ?? "the trade's contractor"}.`
      }
    }

    const { error } = await supabase.from('maintenance_items').update(updates).eq('id', item.id)
    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
    const portalNote = hidden_from_portal === undefined ? '' : hidden_from_portal ? ' Hidden from the contractor portal.' : ' Shown in the contractor portal.'
    return { content: [{ type: 'text', text: `${item_number} updated.${contractorNote}${portalNote}` }] }
  },
)

server.tool(
  'set_portal_visibility',
  'Hide or show maintenance items in the contractor portal, in bulk. Items show by default; hide them to log a list before it is ready for contractors (e.g. before the inspection), then show them and notify. Hidden items are also left out of Notify emails and "new items" counts. Give item_numbers, or a project (optionally narrowed to one unit and/or contractor) to cover all its open items. A job split into steps applies to its steps too.',
  {
    hidden: z.boolean().describe('true to hide from the portal, false to show'),
    item_numbers: z.array(z.string()).optional().describe('Specific items, e.g. ["MI-0081","MI-0082"]'),
    project: z.string().optional().describe('Project name (partial) or ID — every open item in it'),
    unit_id: z.string().optional().describe('Limit a project run to one unit (from list_units)'),
    contractor: z.string().optional().describe('Limit a project run to one contractor (name, partial, or ID)'),
  },
  async ({ hidden, item_numbers, project, unit_id, contractor }) => {
    if (!item_numbers?.length && !project) {
      return { content: [{ type: 'text', text: 'Give item_numbers or a project.' }] }
    }

    let ids: string[] = []
    const notFound: string[] = []

    if (item_numbers?.length) {
      const wanted = item_numbers.map(n => n.trim().toUpperCase())
      const { data, error } = await supabase.from('maintenance_items').select('id, item_number').in('item_number', wanted)
      if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
      const found = new Set((data ?? []).map(i => i.item_number))
      notFound.push(...wanted.filter(n => !found.has(n)))
      ids.push(...(data ?? []).map(i => i.id))
    }

    if (project) {
      const proj = await resolveProjectAny(project)
      if (!proj) return { content: [{ type: 'text', text: `Project "${project}" not found.` }] }
      const unitIds = unit_id ? [unit_id] : await unitIdsForProject(proj.id)
      if (!unitIds.length) return { content: [{ type: 'text', text: `${proj.name} has no units.` }] }
      let q = supabase.from('maintenance_items').select('id').in('unit_id', unitIds)
        .is('archived_at', null).not('status', 'in', '("complete","cancelled")')
      if (contractor) {
        const c = await resolveContractor(contractor)
        if (!c) return { content: [{ type: 'text', text: `Contractor "${contractor}" not found.` }] }
        q = q.eq('contractor_id', c.id)
      }
      const { data, error } = await q
      if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
      ids.push(...(data ?? []).map(i => i.id))
    }

    // Steps of any job in the list follow the job
    if (ids.length) {
      const { data: steps } = await supabase.from('maintenance_items').select('id').in('parent_item_id', ids).is('archived_at', null)
      ids.push(...(steps ?? []).map(s => s.id))
    }
    ids = [...new Set(ids)]
    if (!ids.length) return { content: [{ type: 'text', text: `No matching items.${notFound.length ? ` Not found: ${notFound.join(', ')}` : ''}` }] }

    const { data: changed, error } = await supabase
      .from('maintenance_items')
      .update({ portal_hidden: hidden })
      .in('id', ids)
      .neq('portal_hidden', hidden)
      .select('id, item_number')
    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
    for (const i of changed ?? []) await logActivity(i.id, hidden ? 'portal_hidden' : 'portal_shown')

    const n = changed?.length ?? 0
    const already = ids.length - n
    const lines = [
      `${hidden ? 'Hid' : 'Showed'} ${n} item${n !== 1 ? 's' : ''} ${hidden ? 'from' : 'in'} the contractor portal${n ? `: ${(changed ?? []).map(i => i.item_number).sort().join(', ')}` : ''}.`,
      ...(already ? [`${already} already ${hidden ? 'hidden' : 'shown'}.`] : []),
      ...(notFound.length ? [`Not found: ${notFound.join(', ')}`] : []),
      ...(!hidden && n ? ['Contractors are not emailed automatically — use Notify on their contractor page when ready.'] : []),
    ]
    return { content: [{ type: 'text', text: lines.join('\n') }] }
  },
)

// ─── STEPS ────────────────────────────────────────────────────────────────
// A job (e.g. MI-0166 water pipes banging) can be split into ordered steps, each a
// real item (MI-0166-1, -2, …) with its own instruction, trade, contractor and status,
// shown in that contractor's portal. The first step added moves the job's current
// trade/contractor into step 1. Same instructions for every trade (e.g. popped gib
// screws: builder refix, then painter) = steps with no instructions of their own.

server.tool(
  'add_item_step',
  "Split a maintenance item into steps / add a step to a job. The project's contractor for the trade is assigned automatically unless one is given. If the job has no steps yet, its current trade+contractor become step 1 first. Leave instructions empty to reuse the job's description.",
  {
    item_number: z.string().describe("The job's item number e.g. \"MI-0166\" (not a step number)"),
    trade: z.string().describe('Trade name on the item\'s project (partial match), e.g. "General Building"'),
    instructions: z.string().optional().describe("What this trade needs to do. Omit to use the job's description."),
    contractor: z.string().optional().describe("Contractor company name (partial match). Omit for the project's contractor for the trade."),
    before_step: z.string().optional().describe('Insert before this step number (e.g. "MI-0166-1"); omit to add at the end'),
  },
  async ({ item_number, trade, instructions, contractor, before_step }) => {
    const item = await resolveItemByNumber(item_number)
    if (!item) return { content: [{ type: 'text', text: `Item ${item_number} not found.` }] }
    if (item.parent_item_id) return { content: [{ type: 'text', text: `${item_number} is a step — add steps to its job instead.` }] }
    const { data: unit } = await supabase.from('units').select('project_id').eq('id', item.unit_id).single()
    const { data: t } = await supabase
      .from('trades').select('id, name').eq('project_id', unit?.project_id).ilike('name', `%${trade}%`).limit(1).maybeSingle()
    if (!t) return { content: [{ type: 'text', text: `Trade "${trade}" not found on this item's project. Create it with create_trade first.` }] }
    let contractorId: string | null = null
    if (contractor) {
      const c = await resolveContractor(contractor)
      if (!c) return { content: [{ type: 'text', text: `Contractor "${contractor}" not found.` }] }
      contractorId = c.id
    }
    let beforeId: string | null = null
    if (before_step) {
      const b = await resolveItemByNumber(before_step)
      if (!b || b.parent_item_id !== item.id) return { content: [{ type: 'text', text: `${before_step} is not a step of ${item_number}.` }] }
      beforeId = b.id
    }
    const { data: stepId, error } = await supabase.rpc('add_item_step', {
      p_parent_id: item.id, p_trade_id: t.id, p_contractor_id: contractorId,
      p_description: instructions ?? null, p_before_step_id: beforeId,
    })
    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
    const { data: step } = await supabase.from('maintenance_items')
      .select('item_number, contractor:contractors(company_name)').eq('id', stepId as string).single()
    return { content: [{ type: 'text', text: `Added ${step?.item_number} — ${t.name} → ${(step?.contractor as any)?.company_name ?? 'NO CONTRACTOR yet'}. Use get_maintenance_item ${item.item_number} to see all steps.` }] }
  },
)

server.tool(
  'move_item_step',
  "Move a step earlier or later in its job's order (step numbers stay the same)",
  {
    step_number: z.string().describe('Step item number e.g. "MI-0166-2"'),
    direction: z.enum(['up', 'down']),
  },
  async ({ step_number, direction }) => {
    const step = await resolveItemByNumber(step_number)
    if (!step?.parent_item_id) return { content: [{ type: 'text', text: `${step_number} is not a step.` }] }
    const { error } = await supabase.rpc('move_item_step', { p_step_id: step.id, p_direction: direction === 'up' ? -1 : 1 })
    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
    return { content: [{ type: 'text', text: `Moved ${step_number} ${direction}.` }] }
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

    if (item.has_steps && status !== 'complete') {
      return { content: [{ type: 'text', text: `${item_number} is split into steps, so its status follows them. Update the relevant step instead (or set "complete" to sign off the whole job and all its steps).` }] }
    }
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
  'apply_email_update',
  'Record an internal update on a maintenance item based on an email (not visible to contractors), optionally moving the status forward. Status can only move forward to assigned / in_progress / contractor_complete; "assigned" needs a contractor on the item or a contractor_email matching exactly one active contractor. The same email_message_id is only applied once per item.',
  {
    item_number: z.string().describe('Item number e.g. "MI-0042"'),
    note: z.string().describe('Short update, e.g. "Emailed Smith Plumbing asking them to quote and book in."'),
    new_status: z.enum(['assigned', 'in_progress', 'contractor_complete']).optional(),
    contractor_email: z.string().optional().describe('Contractor email address from the email; sets the contractor only if the item has none'),
    email_message_id: z.string().optional().describe('Outlook message id, used to avoid applying the same email twice'),
    email_subject: z.string().optional(),
    email_from: z.string().optional(),
    email_to: z.string().optional(),
    email_date: z.string().optional().describe('ISO timestamp the email was sent/received'),
  },
  async (args) => {
    const { data, error } = await supabase.rpc('apply_email_update', {
      p_item_number: args.item_number,
      p_note: args.note,
      p_new_status: args.new_status ?? null,
      p_contractor_email: args.contractor_email ?? null,
      p_email_message_id: args.email_message_id ?? null,
      p_email_subject: args.email_subject ?? null,
      p_email_from: args.email_from ?? null,
      p_email_to: args.email_to ?? null,
      p_email_date: args.email_date ?? null,
    })
    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
    // The RPC result doesn't carry unit details; add the unit number + address so
    // the update can be cross-checked against the email.
    const { data: itemUnit } = await supabase
      .from('maintenance_items')
      .select('unit:units(unit_identifier, address)')
      .eq('item_number', args.item_number)
      .maybeSingle()
    const unitLine = itemUnit ? `\nUnit: ${unitLabel(itemUnit.unit as any, '?')}` : ''
    return { content: [{ type: 'text', text: `${JSON.stringify(data)}${unitLine}` }] }
  },
)

server.tool(
  'set_item_contractor',
  'Change which CONTRACTOR (outside trade company, e.g. Boundaryline) does the work on a maintenance item. ' +
    'This is NOT the internal "Responsible" staff field — "assign to me / make <staff> responsible" means that: use assign_item_to_staff.',
  {
    item_number: z.string().describe('Item number e.g. "MI-0042"'),
    contractor: z.string().describe('Contractor company name (partial match)'),
  },
  async ({ item_number, contractor }) => {
    const item = await resolveItemByNumber(item_number)
    if (!item) return { content: [{ type: 'text', text: `Item ${item_number} not found.` }] }

    const c = await resolveContractor(contractor)
    if (!c) return { content: [{ type: 'text', text: `Contractor "${contractor}" not found.` }] }

    // Status is handled by the DB: a new contractor means Logged until they're notified
    const { data: updated, error } = await supabase
      .from('maintenance_items')
      .update({ contractor_id: c.id })
      .eq('id', item.id)
      .select('status')
      .single()

    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
    await logActivity(item.id, `Contractor assigned: ${c.company_name}`)
    const note = updated?.status === 'logged' ? ' Stays Logged until the contractor is notified.' : ''
    return { content: [{ type: 'text', text: `${item_number} contractor set to ${c.company_name} (status: ${updated?.status}).${note}` }] }
  },
)

// ─── STAFF ("Assigned to") ──────────────────────────────────────────────────

/** Find a Maintenance Hub user (profiles) by name or email, partial match. */
async function resolveStaff(nameOrEmail: string) {
  const q = nameOrEmail.trim()
  const { data } = await supabase
    .from('profiles')
    .select('id, email, full_name')
    .or(`full_name.ilike.%${q}%,email.ilike.%${q}%`)
  return data ?? []
}

const staffName = (p: { full_name: string | null; email: string | null }) =>
  p.full_name?.trim() || p.email?.split('@')[0] || 'Unknown user'

server.tool(
  'list_staff',
  'List internal Maintenance Hub staff (app users) who can be "Responsible" for items. These are not contractors.',
  {},
  async () => {
    const { data, error } = await supabase.from('profiles').select('id, email, full_name').order('full_name')
    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
    const text = (data ?? []).map(p => `• ${staffName(p)} | ${p.email ?? '—'} [id: ${p.id}]`).join('\n')
    return { content: [{ type: 'text', text: text || 'No staff found.' }] }
  },
)

server.tool(
  'assign_item_to_staff',
  'Set the internal "Responsible" staff member on a maintenance item (shown as "Assigned to" in older wording). ' +
    'Use this for "assign MI-0042 to me / to Sarah". Does not change the contractor or the status. ' +
    'Pass staff "unassigned" to clear it.',
  {
    item_number: z.string().describe('Item number e.g. "MI-0042"'),
    staff: z.string().describe('Staff member name or email (partial match), or "unassigned"'),
  },
  async ({ item_number, staff }) => {
    const item = await resolveItemByNumber(item_number)
    if (!item) return { content: [{ type: 'text', text: `Item ${item_number} not found.` }] }

    let assignedTo: string | null = null
    let label = 'No one'
    if (staff.trim().toLowerCase() !== 'unassigned') {
      const matches = await resolveStaff(staff)
      if (!matches.length) return { content: [{ type: 'text', text: `No staff member matches "${staff}". Use list_staff.` }] }
      if (matches.length > 1) {
        return { content: [{ type: 'text', text: `"${staff}" matches several staff — be more specific:\n${matches.map(p => `• ${staffName(p)} | ${p.email ?? '—'}`).join('\n')}` }] }
      }
      assignedTo = matches[0].id
      label = staffName(matches[0])
    }

    // The DB trigger logs 'assignee_changed' in the activity log
    const { error } = await supabase.from('maintenance_items').update({ assigned_to: assignedTo }).eq('id', item.id)
    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
    return { content: [{ type: 'text', text: `${item.item_number} — ${item.title}: Responsible — ${label}.` }] }
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
      .select('item_number, title, status, created_at, unit:units(unit_identifier, address, project:projects(name))')
      .in('status', ['logged', 'assigned', 'in_progress'])
      .is('archived_at', null)
      .lt('created_at', cutoff)
      .order('created_at')

    if (unitIds?.length) query = query.in('unit_id', unitIds)

    const { data, error } = await query
    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
    if (!data?.length) return { content: [{ type: 'text', text: `No items overdue by ${days} days.` }] }

    const text = data.map(i => {
      const unit = i.unit as any
      const age = Math.floor((Date.now() - new Date(i.created_at).getTime()) / 86400000)
      return `[${i.item_number}] ${i.title} | ${i.status} | ${(unit?.project as any)?.name ?? '?'} | Unit ${unitLabel(unit, '?')} | ${age}d`
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
        item_number, title, updated_at,
        unit:units(unit_identifier, address, project:projects(name)),
        contractor:contractors(company_name)
      `)
      .eq('status', 'contractor_complete')
      .is('archived_at', null)
      .order('updated_at')

    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }
    if (!data?.length) return { content: [{ type: 'text', text: 'Sign-off queue is empty.' }] }

    const text = data.map(i => {
      const unit = i.unit as any
      const age = Math.floor((Date.now() - new Date(i.updated_at).getTime()) / 86400000)
      return `[${i.item_number}] ${i.title} | ${(unit?.project as any)?.name ?? '?'} | Unit ${unitLabel(unit, '?')} | ${(i.contractor as any)?.company_name ?? '—'} | waiting ${age}d`
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
    include_archived: z.boolean().optional().describe('Also list archived work orders (default false)'),
  },
  async ({ status, project, limit = 10, include_archived = false }) => {
    let query = supabase
      .from('work_orders')
      .select('id, work_order_number, status, sent_at, notes, archived_at, project:projects(name), contractor:contractors(company_name)')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (status && status !== 'all') query = query.eq('status', status)
    if (!include_archived) query = query.is('archived_at', null)

    if (project) {
      const proj = await resolveProjectAny(project)
      if (proj) query = query.eq('project_id', proj.id)
    }

    const { data, error } = await query
    if (error) return { content: [{ type: 'text', text: `Error: ${error.message}` }] }

    const text = data.map(wo => {
      const sentDate = wo.sent_at ? new Date(wo.sent_at).toLocaleDateString('en-NZ') : '—'
      return `[${wo.work_order_number}] ${(wo.project as any)?.name ?? '?'} → ${(wo.contractor as any)?.company_name ?? '?'} | ${wo.status}${wo.archived_at ? ' (archived)' : ''} | sent: ${sentDate} [id: ${wo.id}]`
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
      .select('item_number, title, status, unit:units(unit_identifier, address, owners:unit_owners(name, phone)), trade:trades(name)')
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
        const ownerStr = u?.owners?.length ? u.owners.map((o: any) => `${o.name}${o.phone ? ` (${o.phone})` : ''}`).join(', ') : '—'
        return `  [${i.item_number}] ${i.title} | ${i.status} | Unit ${unitLabel(u, '?')} | ${ownerStr}`
      }),
    ]

    return { content: [{ type: 'text', text: lines.join('\n') }] }
  },
)

server.tool(
  'create_work_order',
  'Create a new work order grouping maintenance items for a contractor. All items must be on the same unit (one work order per unit).',
  {
    project: z.string().describe('Project name (partial) or ID'),
    contractor: z.string().describe('Contractor company name (partial) or ID'),
    item_numbers: z.array(z.string()).describe('Item numbers to include, all on the same unit e.g. ["MI-0001","MI-0005"]'),
    notes: z.string().optional(),
  },
  async ({ project, contractor, item_numbers, notes }) => {
    const proj = await resolveProjectAny(project)
    if (!proj) return { content: [{ type: 'text', text: 'Project not found.' }] }

    const c = await resolveContractor(contractor)
    if (!c) return { content: [{ type: 'text', text: `Contractor "${contractor}" not found.` }] }

    // A work order covers one unit: check before creating anything.
    const items = await Promise.all(item_numbers.map(n => resolveItemByNumber(n)))
    const validIds = items.filter(Boolean).map(i => i!.id)
    const unitIds = new Set(items.filter(Boolean).map(i => i!.unit_id))
    if (unitIds.size > 1) {
      return { content: [{ type: 'text', text: 'Those items are on different units. A work order can only include items from one unit — create one work order per unit.' }] }
    }

    const { data: wo, error: woErr } = await supabase
      .from('work_orders')
      .insert({ project_id: proj.id, contractor_id: c.id, notes: notes ?? null })
      .select('id, work_order_number')
      .single()

    if (woErr) return { content: [{ type: 'text', text: `Error creating work order: ${woErr.message}` }] }

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
