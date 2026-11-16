import ExcelJS from 'exceljs'
import type { MaintenanceStatus } from './types'
import { profileName } from './assignees'
import { formatUnitLabel } from './utils'

// ─── Input shape (what the export route selects from Supabase) ─────────────

export interface ExportOwner {
  name: string
  email: string | null
  phone: string | null
}

export interface ExportUnit {
  id: string
  unit_identifier: string | null
  lot_number: string | null
  address: string | null
  settlement_date: string | null
  owners: ExportOwner[] | null
  project: { id: string; name: string } | null
}

export interface ExportItem {
  id: string
  item_number: string
  title: string
  description: string | null
  status: MaintenanceStatus
  created_at: string
  unit: ExportUnit | null
  trade: { name: string } | null
  contractor: { company_name: string; contact_name: string | null } | null
  assignee: { full_name: string | null; email: string | null } | null
}

// ─── Styling (matches the hand-built "Open Maintenance" workbook) ──────────

const NAVY = 'FF1F3A5F'
const STRIPE = 'FFEEF2F7'
const GREY_TEXT = 'FF6B7280'
const LINK = 'FF1D4ED8'
const BORDER_COLOR = 'FFD1D5DB'
const FONT = 'Arial'

const STATUS_LABEL: Record<MaintenanceStatus, string> = {
  logged: 'Logged',
  assigned: 'Assigned',
  in_progress: 'In progress',
  contractor_complete: 'Contractor complete',
  complete: 'Complete',
}

const STATUS_FILL: Record<MaintenanceStatus, string> = {
  logged: 'FFFDE68A',
  assigned: 'FFBFDBFE',
  in_progress: 'FFBBF7D0',
  contractor_complete: 'FFDDD6FE',
  complete: 'FFE5E7EB',
}

const NO_CONTRACTOR = 'Not yet assigned'

const thinBorder: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: BORDER_COLOR } },
  left: { style: 'thin', color: { argb: BORDER_COLOR } },
  bottom: { style: 'thin', color: { argb: BORDER_COLOR } },
  right: { style: 'thin', color: { argb: BORDER_COLOR } },
}

const solid = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })

// ─── Helpers ───────────────────────────────────────────────────────────────

export function formatNzDate(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const d = typeof value === 'string' ? new Date(value) : value
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Pacific/Auckland' })
}

/** Split "…description… Source: email from … Update 27 Oct 2026: …" into notes + source. */
function splitNotesAndSource(description: string | null): { notes: string; source: string } {
  if (!description) return { notes: '', source: '' }
  const idx = description.search(/\bSource:/)
  if (idx === -1) return { notes: description.trim(), source: '' }
  const before = description.slice(0, idx).trim()
  const rest = description.slice(idx)
  // Source runs until the next dated "Update …" / "Note …" entry (those stay with the notes)
  const end = rest.search(/\s(?:Update|Note)\s+\d{1,2}\s+[A-Z][a-z]{2}\s+\d{4}/)
  const source = (end === -1 ? rest : rest.slice(0, end)).trim()
  const after = end === -1 ? '' : rest.slice(end).trim()
  return { notes: [before, after].filter(Boolean).join('  '), source }
}

export function unitLabel(unit: ExportUnit | null): string {
  return unit?.address || unit?.unit_identifier || (unit?.lot_number ? `Lot ${unit.lot_number}` : 'Unknown unit')
}

/** Unit number when it differs from the address (some imports store the address as the identifier). */
function distinctUnitNumber(unit: ExportUnit): string | null {
  const id = unit.unit_identifier?.trim()
  return id && id !== unit.address?.trim() ? id : null
}

/** Unit number + street address ("A12 · 5 Smith St"), or whichever exists; lot as a last resort. */
function fullUnitLabel(unit: ExportUnit): string {
  return formatUnitLabel({ unit_identifier: distinctUnitNumber(unit), address: unit.address }, unitLabel(unit))
}

function contractorLabel(c: ExportItem['contractor']): string {
  if (!c) return NO_CONTRACTOR
  return c.contact_name ? `${c.company_name} (${c.contact_name})` : c.company_name
}

/** Excel-safe, unique sheet name: "1/4 Campbell Street" → "1-4 Campbell St". */
function makeSheetName(label: string, used: Set<string>): string {
  let base = label
    .replace(/[\\/?*[\]:]/g, '-')
    .replace(/\bStreet\b/g, 'St')
    .replace(/\bRoad\b/g, 'Rd')
    .replace(/\bAvenue\b/g, 'Ave')
    .replace(/\bTerrace\b/g, 'Tce')
    .replace(/\bDrive\b/g, 'Dr')
    .replace(/^'+|'+$/g, '')
    .trim()
    .slice(0, 31) || 'Unit'
  if (base.toLowerCase() === 'summary') base = 'Unit Summary'
  let name = base
  let n = 2
  while (used.has(name.toLowerCase())) {
    const suffix = ` (${n++})`
    name = base.slice(0, 31 - suffix.length) + suffix
  }
  used.add(name.toLowerCase())
  return name
}

const sheetRef = (name: string) => `'${name.replace(/'/g, "''")}'`

/** In-workbook link via HYPERLINK() — portable across Excel, LibreOffice and Google Sheets. */
const internalLink = (target: string, text: string): ExcelJS.CellFormulaValue => ({
  formula: `HYPERLINK("#${target.replace(/"/g, '""')}","${text.replace(/"/g, '""')}")`,
  result: text,
})

const byNatural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

// ─── Unit sheet ────────────────────────────────────────────────────────────

interface UnitGroup {
  unit: ExportUnit
  items: ExportItem[]
  sheetName: string
  firstItemRow: number
  lastItemRow: number
}

const ITEM_COLUMNS: { header: string; width: number }[] = [
  { header: 'Item #', width: 10 },
  { header: 'Item', width: 38 },
  { header: 'Trade', width: 16 },
  { header: 'Contractor', width: 26 },
  { header: 'Status', width: 13 },
  { header: 'Assigned to', width: 16 },
  { header: 'Logged', width: 12 },
  { header: 'Notes', width: 60 },
  { header: 'Source', width: 40 },
]

function buildUnitSheet(wb: ExcelJS.Workbook, group: UnitGroup, opts: { withBackLink: boolean; openOnly: boolean }) {
  const { unit, items } = group
  const ws = wb.addWorksheet(group.sheetName, {
    views: [{ showGridLines: false }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  ws.columns = ITEM_COLUMNS.map(c => ({ width: c.width }))

  const title = ws.getCell('A1')
  title.value = fullUnitLabel(unit)
  title.font = { name: FONT, size: 16, bold: true, color: { argb: NAVY } }

  const sub = [
    unit.project?.name ?? '',
    unit.lot_number ? `Lot ${unit.lot_number}` : '',
    `Settled ${unit.settlement_date ? formatNzDate(unit.settlement_date) : '—'}`,
  ].filter(Boolean).join('  ·  ')
  ws.getCell('A2').value = sub
  ws.getCell('A2').font = { name: FONT, size: 10, color: { argb: GREY_TEXT } }

  if (opts.withBackLink) {
    const back = ws.getCell('A3')
    back.value = internalLink("'Summary'!A1", '← Back to Summary')
    back.font = { name: FONT, size: 9, underline: true, color: { argb: LINK } }
  }

  // Owner contacts
  let row = 5
  ws.getCell(`A${row}`).value = 'OWNER CONTACTS'
  ws.getCell(`A${row}`).font = { name: FONT, size: 11, bold: true, color: { argb: NAVY } }
  row++
  const contactHeader = ws.getRow(row)
  ws.mergeCells(`A${row}:B${row}`)
  contactHeader.getCell(1).value = 'Name'
  contactHeader.getCell(3).value = 'Email'
  contactHeader.getCell(4).value = 'Phone'
  for (const col of [1, 2, 3, 4]) {
    const c = contactHeader.getCell(col)
    c.font = { name: FONT, size: 10, bold: true }
    c.fill = solid(STRIPE)
    c.border = thinBorder
  }
  row++
  const owners = unit.owners?.length ? unit.owners : [{ name: '—', email: null, phone: null }]
  for (const o of owners) {
    ws.mergeCells(`A${row}:B${row}`)
    const r = ws.getRow(row)
    r.getCell(1).value = o.name || '—'
    r.getCell(3).value = o.email || '—'
    r.getCell(4).value = o.phone || '—'
    for (const col of [1, 2, 3, 4]) {
      const c = r.getCell(col)
      c.font = { name: FONT, size: 10 }
      c.alignment = { vertical: 'middle' }
      c.border = thinBorder
    }
    row++
  }

  // Items table
  row++
  ws.getCell(`A${row}`).value = `${opts.openOnly ? 'OPEN ' : ''}MAINTENANCE ITEMS (${items.length})`
  ws.getCell(`A${row}`).font = { name: FONT, size: 11, bold: true, color: { argb: NAVY } }
  row++
  const headerRow = ws.getRow(row)
  ITEM_COLUMNS.forEach((col, i) => {
    const c = headerRow.getCell(i + 1)
    c.value = col.header
    c.font = { name: FONT, size: 10, bold: true, color: { argb: 'FFFFFFFF' } }
    c.fill = solid(NAVY)
    c.border = thinBorder
    c.alignment = { vertical: 'middle' }
  })
  ws.views = [{ state: 'frozen', ySplit: row, showGridLines: false }]
  if (items.length) ws.autoFilter = { from: { row, column: 1 }, to: { row, column: ITEM_COLUMNS.length } }
  row++

  group.firstItemRow = row
  for (const item of items) {
    const { notes, source } = splitNotesAndSource(item.description)
    const r = ws.getRow(row)
    r.values = [
      item.item_number,
      item.title,
      item.trade?.name ?? '—',
      contractorLabel(item.contractor),
      STATUS_LABEL[item.status] ?? item.status,
      item.assignee ? profileName(item.assignee) : 'Unassigned',
      formatNzDate(item.created_at),
      notes,
      source,
    ]
    for (let col = 1; col <= ITEM_COLUMNS.length; col++) {
      const c = r.getCell(col)
      c.font = { name: FONT, size: 10 }
      c.alignment = { vertical: 'top', wrapText: true }
      c.border = thinBorder
    }
    if (!item.contractor) r.getCell(4).font = { name: FONT, size: 10, italic: true, color: { argb: GREY_TEXT } }
    r.getCell(5).fill = solid(STATUS_FILL[item.status] ?? STRIPE)
    if (!item.assignee) r.getCell(6).font = { name: FONT, size: 10, italic: true, color: { argb: GREY_TEXT } }
    r.getCell(9).font = { name: FONT, size: 9, color: { argb: GREY_TEXT } }
    row++
  }
  group.lastItemRow = Math.max(row - 1, group.firstItemRow)
}

// ─── Summary sheet ─────────────────────────────────────────────────────────

function buildSummarySheet(
  ws: ExcelJS.Worksheet,
  groups: UnitGroup[],
  opts: { title: string; exportedAt: Date; openOnly: boolean; multiProject: boolean },
) {
  const cols: { header: string; width: number }[] = [
    ...(opts.multiProject ? [{ header: 'Project', width: 24 }] : []),
    { header: 'Unit', width: 14 },
    { header: 'Address', width: 30 },
    { header: 'Lot', width: 10 },
    { header: 'Owner(s)', width: 44 },
    { header: opts.openOnly ? 'Open items' : 'Items', width: 12 },
    { header: 'No contractor yet', width: 16 },
    { header: 'In progress', width: 12 },
  ]
  ws.columns = cols.map(c => ({ width: c.width }))
  const off = opts.multiProject ? 1 : 0
  const colLetter = (i: number) => String.fromCharCode(65 + i)

  ws.getCell('A1').value = opts.title
  ws.getCell('A1').font = { name: FONT, size: 16, bold: true, color: { argb: NAVY } }
  const unitWord = groups.length === 1 ? 'unit' : 'units'
  ws.getCell('A2').value =
    `Exported from Maintenance Hub on ${formatNzDate(opts.exportedAt)} · ${groups.length} ${unitWord} with ${opts.openOnly ? 'open ' : ''}items · click a unit to open its tab`
  ws.getCell('A2').font = { name: FONT, size: 10, color: { argb: GREY_TEXT } }

  const header = ws.getRow(4)
  header.height = 27
  cols.forEach((c, i) => {
    const cell = header.getCell(i + 1)
    cell.value = c.header
    cell.font = { name: FONT, size: 11, bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = solid(NAVY)
    cell.border = thinBorder
    cell.alignment = { vertical: 'middle', wrapText: true }
  })

  let row = 5
  groups.forEach((g, idx) => {
    const r = ws.getRow(row)
    const ref = sheetRef(g.sheetName)
    const range = (col: string) => `${ref}!${col}${g.firstItemRow}:${col}${g.lastItemRow}`
    const n = g.items.length
    const noContractor = g.items.filter(i => !i.contractor).length
    const inProgress = g.items.filter(i => i.status === 'in_progress').length

    if (opts.multiProject) r.getCell(1).value = g.unit.project?.name ?? '—'
    // Unit number links to the unit's tab; projects without unit numbers (e.g. Karori) link on the address
    r.getCell(1 + off).value = internalLink(`${ref}!A1`, distinctUnitNumber(g.unit) ?? unitLabel(g.unit))
    r.getCell(2 + off).value = g.unit.address?.trim() || '—'
    r.getCell(3 + off).value = g.unit.lot_number || '—'
    r.getCell(4 + off).value = g.unit.owners?.map(o => o.name).filter(Boolean).join(', ') || '—'
    r.getCell(5 + off).value = { formula: `COUNTA(${range('A')})`, result: n }
    r.getCell(6 + off).value = { formula: `COUNTIF(${range('D')},"${NO_CONTRACTOR}")`, result: noContractor }
    r.getCell(7 + off).value = { formula: `COUNTIF(${range('E')},"${STATUS_LABEL.in_progress}")`, result: inProgress }

    for (let col = 1; col <= cols.length; col++) {
      const c = r.getCell(col)
      c.font = { name: FONT, size: 10 }
      c.border = thinBorder
      c.alignment = { vertical: 'middle', wrapText: true, horizontal: col > 4 + off ? 'center' : 'left' }
      if (idx % 2 === 1) c.fill = solid(STRIPE)
    }
    r.getCell(1 + off).font = { name: FONT, size: 10, underline: true, color: { argb: LINK } }
    row++
  })

  const totals = ws.getRow(row)
  totals.getCell(1).value = 'Total'
  totals.getCell(1).font = { name: FONT, size: 11, bold: true }
  for (let col = 5 + off; col <= 7 + off; col++) {
    const L = colLetter(col - 1)
    const sum = groups.reduce((acc, g) => {
      if (col === 5 + off) return acc + g.items.length
      if (col === 6 + off) return acc + g.items.filter(i => !i.contractor).length
      return acc + g.items.filter(i => i.status === 'in_progress').length
    }, 0)
    const c = totals.getCell(col)
    c.value = groups.length ? { formula: `SUM(${L}5:${L}${row - 1})`, result: sum } : 0
    c.font = { name: FONT, size: 11, bold: true }
    c.alignment = { horizontal: 'center' }
  }

  ws.views = [{ state: 'frozen', ySplit: 4, showGridLines: false }]
}

// ─── Public entry point ────────────────────────────────────────────────────

export interface BuildExportOptions {
  /** Project name when the export is scoped to one project (used in titles). */
  projectName?: string | null
  /** When true, produce a single unit sheet with no summary tab. */
  singleUnit?: boolean
  /** Assignee filter in effect, e.g. "Sam" or "Sam + unassigned" (shown in title + filename). */
  assigneeLabel?: string | null
  exportedAt?: Date
}

export async function buildMaintenanceWorkbook(items: ExportItem[], options: BuildExportOptions = {}) {
  const exportedAt = options.exportedAt ?? new Date()
  const openOnly = items.length > 0 && items.every(i => i.status !== 'complete')

  // Group by unit
  const map = new Map<string, { unit: ExportUnit; items: ExportItem[] }>()
  for (const item of items) {
    if (!item.unit) continue
    const g = map.get(item.unit.id) ?? { unit: item.unit, items: [] }
    g.items.push(item)
    map.set(item.unit.id, g)
  }
  const projectNames = new Set([...map.values()].map(g => g.unit.project?.name ?? ''))
  const multiProject = projectNames.size > 1

  const used = new Set<string>(['summary'])
  const groups: UnitGroup[] = [...map.values()]
    .sort((a, b) =>
      byNatural(a.unit.project?.name ?? '', b.unit.project?.name ?? '') || byNatural(unitLabel(a.unit), unitLabel(b.unit)),
    )
    .map(g => ({
      ...g,
      items: g.items.sort((a, b) => byNatural(a.item_number, b.item_number)),
      sheetName: '',
      firstItemRow: 0,
      lastItemRow: 0,
    }))
  for (const g of groups) {
    const label = multiProject ? `${g.unit.project?.name ?? ''} ${unitLabel(g.unit)}` : unitLabel(g.unit)
    g.sheetName = makeSheetName(label, used)
  }

  const wb = new ExcelJS.Workbook()
  wb.creator = 'Maintenance Hub'
  wb.created = exportedAt

  const heading = `${openOnly ? 'Open ' : ''}Maintenance${options.assigneeLabel ? ` (${options.assigneeLabel})` : ''}`

  if (options.singleUnit && groups.length === 1) {
    buildUnitSheet(wb, groups[0], { withBackLink: false, openOnly })
  } else {
    const scope = options.projectName ?? (multiProject ? 'All Projects' : [...projectNames][0] || 'Maintenance Hub')
    const summary = wb.addWorksheet('Summary')
    for (const g of groups) buildUnitSheet(wb, g, { withBackLink: true, openOnly })
    buildSummarySheet(summary, groups, { title: `${scope} — ${heading}`, exportedAt, openOnly, multiProject })
  }

  const scopeName = options.singleUnit && groups[0]
    ? `${groups[0].unit.project?.name ?? ''} - ${fullUnitLabel(groups[0].unit)}`
    : options.projectName ?? 'All Projects'
  const filename = `${scopeName} - ${heading} - ${formatNzDate(exportedAt)}.xlsx`.replace(/[\\/:*?"<>|]/g, '-')

  const buffer = await wb.xlsx.writeBuffer()
  return { buffer, filename }
}
