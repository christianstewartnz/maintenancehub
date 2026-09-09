'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronRight, AlertTriangle, Clock, CalendarDays, ChevronLeft, ChevronRight as ChevronRightIcon } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { StatusBadge, PriorityBadge } from '@/components/ui/StatusBadge'
import { getDaysSince, getAgeClass } from '@/lib/utils'
import type { Project, MaintenanceItem, MaintenanceStatus } from '@/lib/types'

const AMBER_DAYS = 7
const RED_DAYS = 14

interface Props {
  projects: Project[]
  items: MaintenanceItem[]
  scheduledItems: MaintenanceItem[]
}

// ─── Date helpers ────────────────────────────────────────────────────────────
function toLocalDateStr(date: Date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function startOfWeek(date: Date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const day = d.getDay()
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day))
  return d
}

function addDays(date: Date, n: number) {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

function formatMonthYear(date: Date) {
  return date.toLocaleDateString('en-NZ', { month: 'long', year: 'numeric' })
}

// ─── Group items by project → unit for a given date ──────────────────────────
interface UnitGroup {
  unitId: string
  unitIdentifier: string
  address: string | null
  projectId: string
  projectName: string
  items: MaintenanceItem[]
}

interface ProjectGroup {
  projectId: string
  projectName: string
  units: UnitGroup[]
}

function groupByProjectUnit(items: MaintenanceItem[]): ProjectGroup[] {
  const projectMap = new Map<string, ProjectGroup>()

  for (const item of items) {
    const unit = item.unit as any
    const project = unit?.project
    if (!unit || !project) continue

    if (!projectMap.has(project.id)) {
      projectMap.set(project.id, { projectId: project.id, projectName: project.name, units: [] })
    }
    const pg = projectMap.get(project.id)!
    let ug = pg.units.find(u => u.unitId === unit.id)
    if (!ug) {
      ug = { unitId: unit.id, unitIdentifier: unit.unit_identifier, address: unit.address, projectId: project.id, projectName: project.name, items: [] }
      pg.units.push(ug)
    }
    ug.items.push(item)
  }

  return Array.from(projectMap.values())
}

// ─── Unit card: unit number prominent, items listed below ────────────────────
function UnitCard({ group }: { group: UnitGroup }) {
  return (
    <div style={{
      background: 'white',
      border: '1px solid #e9e9e7',
      borderRadius: 8,
      overflow: 'hidden',
    }}>
      {/* Unit header */}
      <div style={{ padding: '12px 14px', borderBottom: '1px solid #f1f1ef' }}>
        <div style={{ fontSize: 11, color: '#787774', marginBottom: 2, fontWeight: 500 }}>{group.projectName}</div>
        <div style={{ fontSize: 17, fontWeight: 700, color: '#37352f' }}>{group.unitIdentifier}</div>
        {group.address && <div style={{ fontSize: 12, color: '#787774', marginTop: 2 }}>{group.address}</div>}
      </div>
      {/* Items */}
      <div style={{ padding: '8px 0' }}>
        {group.items.map(item => {
          const trade = (item.trade as any)?.name
          const contractor = (item.contractor as any)?.company_name
          return (
            <Link
              key={item.id}
              href={`/maintenance/${item.id}`}
              style={{ display: 'block', textDecoration: 'none', padding: '7px 14px' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <StatusBadge status={item.status} />
                <PriorityBadge priority={item.priority} />
                {trade && (
                  <span style={{ fontSize: 11, color: '#787774', background: '#f0f0ee', borderRadius: 4, padding: '1px 6px' }}>
                    {trade}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 13, fontWeight: 500, color: '#37352f', marginTop: 3 }}>{item.title}</div>
              {contractor && <div style={{ fontSize: 11, color: '#a0a09e', marginTop: 1 }}>{contractor}</div>}
            </Link>
          )
        })}
      </div>
    </div>
  )
}

// ─── Today section ────────────────────────────────────────────────────────────
function TodaySection({ items }: { items: MaintenanceItem[] }) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayStr = toLocalDateStr(today)
  const todayItems = items.filter(i => i.scheduled_date === todayStr)
  const groups = groupByProjectUnit(todayItems)
  const unitCount = groups.reduce((s, g) => s + g.units.length, 0)

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <CalendarDays size={18} style={{ color: '#2383e2' }} />
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#37352f' }}>
          Today — {today.toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long' })}
        </h2>
        {unitCount > 0 && (
          <span style={{ background: '#2383e2', color: 'white', borderRadius: 12, fontSize: 12, fontWeight: 600, padding: '2px 8px' }}>
            {unitCount} unit{unitCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {unitCount === 0 ? (
        <div style={{ background: '#f7f7f5', border: '1px solid #e9e9e7', borderRadius: 10, padding: '24px', textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: 14, color: '#787774' }}>No work scheduled for today</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {groups.map(pg => (
            <div key={pg.projectId}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#787774', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                {pg.projectName}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
                {pg.units.map(ug => <UnitCard key={ug.unitId} group={ug} />)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Day popup (shown on hover/click in week/month) ───────────────────────────
function DayPopup({ dateStr, items, onClose }: { dateStr: string; items: MaintenanceItem[]; onClose: () => void }) {
  const dayItems = items.filter(i => i.scheduled_date === dateStr)
  const groups = groupByProjectUnit(dayItems)
  const label = new Date(dateStr + 'T00:00:00').toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 100,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{ background: 'white', borderRadius: 12, padding: 20, maxWidth: 520, width: '90%', maxHeight: '70vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#37352f' }}>{label}</h3>
          <button className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: 16 }} onClick={onClose}>✕</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {groups.map(pg => (
            <div key={pg.projectId}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#787774', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                {pg.projectName}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {pg.units.map(ug => <UnitCard key={ug.unitId} group={ug} />)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Week slider ──────────────────────────────────────────────────────────────
function WeekSlider({ items, onExpandMonth }: { items: MaintenanceItem[]; onExpandMonth: () => void }) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayStr = toLocalDateStr(today)
  const weekStart = startOfWeek(today)
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const [popup, setPopup] = useState<string | null>(null)

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#37352f' }}>This Week</h2>
        <button
          className="btn btn-ghost"
          style={{ fontSize: 13, color: '#2383e2', padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 5 }}
          onClick={onExpandMonth}
        >
          <CalendarDays size={13} /> View full calendar
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8 }}>
        {days.map(day => {
          const dateStr = toLocalDateStr(day)
          const isToday = dateStr === todayStr
          const isPast = day < today
          const dayItems = items.filter(i => i.scheduled_date === dateStr)
          const unitGroups = groupByProjectUnit(dayItems)
          const unitCount = unitGroups.reduce((s, g) => s + g.units.length, 0)

          return (
            <div
              key={dateStr}
              onClick={() => unitCount > 0 && setPopup(dateStr)}
              style={{
                border: isToday ? '2px solid #2383e2' : '1px solid #e9e9e7',
                borderRadius: 8,
                padding: '10px 8px',
                background: isToday ? '#f0f7ff' : isPast ? '#fafaf9' : 'white',
                minHeight: 90,
                cursor: unitCount > 0 ? 'pointer' : 'default',
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 600, color: isToday ? '#2383e2' : isPast ? '#a0a09e' : '#787774', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {day.toLocaleDateString('en-NZ', { weekday: 'short' })}
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: isToday ? '#2383e2' : isPast ? '#a0a09e' : '#37352f', marginBottom: 6 }}>
                {day.getDate()}
              </div>
              {unitCount === 0 ? (
                <div style={{ fontSize: 11, color: '#c7c7c4' }}>—</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {unitGroups.flatMap(g => g.units).slice(0, 3).map(ug => (
                    <div key={ug.unitId} style={{
                      fontSize: 11, fontWeight: 600, color: '#37352f',
                      background: '#eef4ff', borderRadius: 4, padding: '2px 6px',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }} title={`${ug.projectName} · ${ug.unitIdentifier}`}>
                      {ug.unitIdentifier}
                      <span style={{ fontWeight: 400, color: '#787774', marginLeft: 3, fontSize: 10 }}>
                        {ug.items.length} item{ug.items.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                  ))}
                  {unitCount > 3 && (
                    <div style={{ fontSize: 10, color: '#787774' }}>+{unitCount - 3} more</div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {popup && <DayPopup dateStr={popup} items={items} onClose={() => setPopup(null)} />}
    </div>
  )
}

// ─── Month calendar ───────────────────────────────────────────────────────────
function MonthCalendar({ items, onClose }: { items: MaintenanceItem[]; onClose: () => void }) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayStr = toLocalDateStr(today)
  const [viewDate, setViewDate] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [popup, setPopup] = useState<string | null>(null)

  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const startPad = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1
  const cells: (Date | null)[] = [
    ...Array(startPad).fill(null),
    ...Array.from({ length: lastDay.getDate() }, (_, i) => new Date(year, month, i + 1)),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn btn-ghost" style={{ padding: '4px 8px' }} onClick={() => setViewDate(new Date(year, month - 1, 1))}>
            <ChevronLeft size={16} />
          </button>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#37352f' }}>{formatMonthYear(viewDate)}</h2>
          <button className="btn btn-ghost" style={{ padding: '4px 8px' }} onClick={() => setViewDate(new Date(year, month + 1, 1))}>
            <ChevronRightIcon size={16} />
          </button>
        </div>
        <button className="btn btn-ghost" style={{ fontSize: 13, color: '#787774', padding: '4px 10px' }} onClick={onClose}>
          ✕ Close
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 4 }}>
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
          <div key={d} style={{ fontSize: 11, fontWeight: 600, color: '#787774', textAlign: 'center', padding: '4px 0', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {d}
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {cells.map((day, i) => {
          if (!day) return <div key={`empty-${i}`} style={{ minHeight: 72 }} />
          const dateStr = toLocalDateStr(day)
          const isToday = dateStr === todayStr
          const isPast = day < today
          const dayItems = items.filter(i => i.scheduled_date === dateStr)
          const unitGroups = groupByProjectUnit(dayItems)
          const allUnits = unitGroups.flatMap(g => g.units)
          const unitCount = allUnits.length

          return (
            <div
              key={dateStr}
              onClick={() => unitCount > 0 && setPopup(dateStr)}
              style={{
                border: isToday ? '2px solid #2383e2' : '1px solid #e9e9e7',
                borderRadius: 6,
                padding: '6px',
                background: isToday ? '#f0f7ff' : isPast ? '#fafaf9' : 'white',
                minHeight: 72,
                cursor: unitCount > 0 ? 'pointer' : 'default',
              }}
            >
              <div style={{ fontSize: 12, fontWeight: isToday ? 700 : 500, color: isToday ? '#2383e2' : isPast ? '#a0a09e' : '#37352f', marginBottom: 4 }}>
                {day.getDate()}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {allUnits.slice(0, 2).map(ug => (
                  <div key={ug.unitId} style={{
                    fontSize: 10, fontWeight: 600, color: '#37352f',
                    background: '#eef4ff', borderRadius: 3, padding: '1px 4px',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }} title={`${ug.projectName} · ${ug.unitIdentifier}`}>
                    {ug.unitIdentifier}
                  </div>
                ))}
                {unitCount > 2 && <div style={{ fontSize: 10, color: '#787774' }}>+{unitCount - 2}</div>}
              </div>
            </div>
          )
        })}
      </div>

      {popup && <DayPopup dateStr={popup} items={items} onClose={() => setPopup(null)} />}
    </div>
  )
}

// ─── Main dashboard ───────────────────────────────────────────────────────────
export default function DashboardClient({ projects, items, scheduledItems }: Props) {
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set())
  const [expandedUnits, setExpandedUnits] = useState<Set<string>>(new Set())
  const [statusFilter, setStatusFilter] = useState<MaintenanceStatus | 'all'>('all')
  const [isLive, setIsLive] = useState(false)
  const [showMonthCalendar, setShowMonthCalendar] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    const channel = supabase
      .channel('dashboard_realtime')
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'maintenance_items' }, () => router.refresh())
      .subscribe((status: string) => setIsLive(status === 'SUBSCRIBED'))
    return () => { supabase.removeChannel(channel) }
  }, [])

  const filteredItems = statusFilter === 'all' ? items : items.filter(i => i.status === statusFilter)

  const projectGroups = projects.map(project => {
    const projectItems = filteredItems.filter(
      item => (item.unit as any)?.project_id === project.id || (item.unit as any)?.project?.id === project.id
    )
    const unitMap = new Map<string, { unitId: string; unitIdentifier: string; address: string | null; items: MaintenanceItem[] }>()
    for (const item of projectItems) {
      const unit = item.unit as any
      if (!unit) continue
      if (!unitMap.has(unit.id)) unitMap.set(unit.id, { unitId: unit.id, unitIdentifier: unit.unit_identifier, address: unit.address, items: [] })
      unitMap.get(unit.id)!.items.push(item)
    }
    const units = Array.from(unitMap.values()).sort((a, b) => a.unitIdentifier.localeCompare(b.unitIdentifier))
    const overdueCount = projectItems.filter(i => getDaysSince(i.created_at) >= RED_DAYS).length
    const awaitingConfirm = projectItems.filter(i => i.status === 'contractor_complete').length
    return { project, units, totalOpen: projectItems.length, overdueCount, awaitingConfirm }
  }).filter(g => g.totalOpen > 0)

  const totalOpen = items.length
  const totalOverdue = items.filter(i => getDaysSince(i.created_at) >= RED_DAYS).length
  const totalAwaitingConfirm = items.filter(i => i.status === 'contractor_complete').length

  function toggleProject(id: string) {
    setExpandedProjects(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleUnit(id: string) {
    setExpandedUnits(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  return (
    <div className="page-content" style={{ padding: '24px 32px' }}>
      {/* Live indicator */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div className={`live-dot ${isLive ? 'live-dot--active' : ''}`} />
          <span style={{ fontSize: 12, color: '#787774' }}>{isLive ? 'Live' : 'Connecting…'}</span>
        </div>
        {totalAwaitingConfirm > 0 && (
          <Link href="/sign-off" className="btn btn-secondary" style={{ fontSize: 13, padding: '4px 12px' }}>
            <Clock size={13} style={{ color: '#9a6700' }} /> {totalAwaitingConfirm} awaiting sign-off
          </Link>
        )}
      </div>

      {/* Today */}
      <TodaySection items={scheduledItems} />

      {/* Week / Month */}
      {showMonthCalendar
        ? <MonthCalendar items={scheduledItems} onClose={() => setShowMonthCalendar(false)} />
        : <WeekSlider items={scheduledItems} onExpandMonth={() => setShowMonthCalendar(true)} />
      }

      {/* Stats — small & secondary */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        <MiniStat value={totalOpen} label="Open items" />
        <MiniStat value={totalOverdue} label="Overdue (14+ days)" color="#e03c3c" icon={<AlertTriangle size={13} />} />
        <MiniStat value={totalAwaitingConfirm} label="Awaiting confirmation" color="#9a6700" icon={<Clock size={13} />} />
      </div>

      {/* Filter */}
      <div className="filter-bar" style={{ marginBottom: 20 }}>
        <span style={{ fontSize: 13, color: '#787774', marginRight: 4 }}>Filter:</span>
        {(['all', 'logged', 'assigned', 'in_progress', 'contractor_complete'] as const).map(s => (
          <button key={s} className={`btn ${statusFilter === s ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '4px 12px', fontSize: 13 }} onClick={() => setStatusFilter(s)}>
            {s === 'all' ? 'All' : s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
          </button>
        ))}
      </div>

      {/* Project accordion */}
      {projectGroups.length === 0 ? (
        <div className="empty-state">
          <p style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>No open maintenance items</p>
          <p style={{ fontSize: 14 }}>All clear! Create maintenance items from the Maintenance page.</p>
          <Link href="/maintenance" className="btn btn-primary" style={{ marginTop: 16 }}>Go to Maintenance</Link>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {projectGroups.map(({ project, units, totalOpen: count, overdueCount, awaitingConfirm }) => (
            <div key={project.id} style={{ border: '1px solid #e9e9e7', borderRadius: 8, overflow: 'hidden' }}>
              <button
                onClick={() => toggleProject(project.id)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: '#f7f7f5', border: 'none', cursor: 'pointer', textAlign: 'left' }}
              >
                {expandedProjects.has(project.id) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                <span style={{ fontWeight: 600, fontSize: 15, color: '#37352f', flex: 1 }}>{project.name}</span>
                <div style={{ display: 'flex', gap: 12, fontSize: 13, color: '#787774' }}>
                  <span>{count} open</span>
                  {overdueCount > 0 && <span style={{ color: '#e03c3c' }}>{overdueCount} overdue</span>}
                  {awaitingConfirm > 0 && <span style={{ color: '#9a6700' }}>{awaitingConfirm} to confirm</span>}
                </div>
                <Link href={`/projects/${project.id}`} className="btn btn-ghost" style={{ fontSize: 13, padding: '3px 10px', marginLeft: 8 }} onClick={e => e.stopPropagation()}>
                  View project
                </Link>
              </button>

              {expandedProjects.has(project.id) && (
                <div style={{ padding: '8px 0' }}>
                  {units.length === 0 ? (
                    <p style={{ padding: '12px 20px', color: '#787774', fontSize: 14 }}>No items match current filter.</p>
                  ) : units.map(unit => (
                    <div key={unit.unitId} style={{ borderTop: '1px solid #f1f1ef' }}>
                      <button
                        onClick={() => toggleUnit(unit.unitId)}
                        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                      >
                        {expandedUnits.has(unit.unitId) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        <span style={{ fontWeight: 500, color: '#37352f' }}>{unit.unitIdentifier}</span>
                        {unit.address && <span style={{ color: '#787774', fontSize: 13 }}>{unit.address}</span>}
                        <span style={{ marginLeft: 'auto', fontSize: 13, color: '#787774' }}>{unit.items.length} item{unit.items.length !== 1 ? 's' : ''}</span>
                      </button>

                      {expandedUnits.has(unit.unitId) && (
                        <div style={{ padding: '0 20px 12px' }}>
                          <table className="data-table">
                            <thead>
                              <tr><th>#</th><th>Title</th><th>Status</th><th>Priority</th><th>Age</th><th>Scheduled</th><th>Contractor</th></tr>
                            </thead>
                            <tbody>
                              {unit.items.map(item => {
                                const days = getDaysSince(item.created_at)
                                return (
                                  <tr key={item.id} className={getAgeClass(item.created_at, AMBER_DAYS, RED_DAYS)}>
                                    <td style={{ color: '#787774', fontSize: 13 }}>{item.item_number}</td>
                                    <td>
                                      <Link href={`/maintenance/${item.id}`} style={{ color: '#37352f', textDecoration: 'none', fontWeight: 500 }}>{item.title}</Link>
                                    </td>
                                    <td><StatusBadge status={item.status} /></td>
                                    <td><PriorityBadge priority={item.priority} /></td>
                                    <td style={{ fontSize: 13, color: days >= RED_DAYS ? '#e03c3c' : days >= AMBER_DAYS ? '#9a6700' : '#787774' }}>{days}d</td>
                                    <td style={{ fontSize: 13, color: '#787774' }}>
                                      {item.scheduled_date ? new Date(item.scheduled_date + 'T00:00:00').toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' }) : '—'}
                                    </td>
                                    <td style={{ fontSize: 13, color: '#787774' }}>{(item.contractor as any)?.company_name ?? '—'}</td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function MiniStat({ value, label, color = '#37352f', icon }: { value: number; label: string; color?: string; icon?: React.ReactNode }) {
  return (
    <div style={{ background: '#f7f7f5', border: '1px solid #e9e9e7', borderRadius: 6, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
      {icon && <span style={{ color }}>{icon}</span>}
      <span style={{ fontSize: 18, fontWeight: 700, color }}>{value}</span>
      <span style={{ fontSize: 12, color: '#787774' }}>{label}</span>
    </div>
  )
}
