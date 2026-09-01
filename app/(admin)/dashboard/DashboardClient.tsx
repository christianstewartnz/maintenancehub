'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronRight, AlertTriangle, Clock } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { StatusBadge, PriorityBadge } from '@/components/ui/StatusBadge'
import { getDaysSince, getAgeClass } from '@/lib/utils'
import type { Project, MaintenanceItem, MaintenanceStatus } from '@/lib/types'

const AMBER_DAYS = 7
const RED_DAYS = 14

interface Props {
  projects: Project[]
  items: MaintenanceItem[]
}

interface UnitGroup {
  unitId: string
  unitIdentifier: string
  address: string | null
  items: MaintenanceItem[]
}

interface ProjectGroup {
  project: Project
  units: UnitGroup[]
  totalOpen: number
  overdueCount: number
  awaitingConfirm: number
}

export default function DashboardClient({ projects, items }: Props) {
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set())
  const [expandedUnits, setExpandedUnits] = useState<Set<string>>(new Set())
  const [statusFilter, setStatusFilter] = useState<MaintenanceStatus | 'all'>('all')
  const [isLive, setIsLive] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    const channel = supabase
      .channel('dashboard_realtime')
      .on('postgres_changes' as any, {
        event: '*',
        schema: 'public',
        table: 'maintenance_items',
      }, () => {
        router.refresh()
      })
      .subscribe((status: string) => setIsLive(status === 'SUBSCRIBED'))

    return () => { supabase.removeChannel(channel) }
  }, [])

  const filteredItems = statusFilter === 'all' ? items : items.filter(i => i.status === statusFilter)

  const projectGroups: ProjectGroup[] = projects.map(project => {
    const projectItems = filteredItems.filter(
      item => (item.unit as any)?.project_id === project.id || (item.unit as any)?.project?.id === project.id
    )

    const unitMap = new Map<string, UnitGroup>()
    for (const item of projectItems) {
      const unit = item.unit as any
      if (!unit) continue
      if (!unitMap.has(unit.id)) {
        unitMap.set(unit.id, { unitId: unit.id, unitIdentifier: unit.unit_identifier, address: unit.address, items: [] })
      }
      unitMap.get(unit.id)!.items.push(item)
    }

    const units = Array.from(unitMap.values()).sort((a, b) => a.unitIdentifier.localeCompare(b.unitIdentifier))
    const overdueCount = projectItems.filter(i => getDaysSince(i.created_at) >= RED_DAYS).length
    const awaitingConfirm = projectItems.filter(i => i.status === 'contractor_complete').length

    return { project, units, totalOpen: projectItems.length, overdueCount, awaitingConfirm }
  }).filter(g => g.totalOpen > 0 || true)

  const totalOpen = items.length
  const totalOverdue = items.filter(i => getDaysSince(i.created_at) >= RED_DAYS).length
  const totalAwaitingConfirm = items.filter(i => i.status === 'contractor_complete').length

  function toggleProject(id: string) {
    setExpandedProjects(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleUnit(id: string) {
    setExpandedUnits(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <div className="page-content" style={{ padding: '24px 32px' }}>
      {/* Live indicator */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div className={`live-dot ${isLive ? 'live-dot--active' : ''}`} />
          <span style={{ fontSize: 12, color: '#787774' }}>{isLive ? 'Live' : 'Connecting…'}</span>
        </div>
        {totalAwaitingConfirm > 0 && (
          <Link href="/sign-off" className="btn btn-secondary" style={{ fontSize: 13, padding: '4px 12px' }}>
            <Clock size={13} style={{ color: '#9a6700' }} />
            {totalAwaitingConfirm} awaiting sign-off
          </Link>
        )}
      </div>

      {/* Summary stats */}
      <div className="stat-grid-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 28 }}>
        <StatCard value={totalOpen} label="Open items" color="#37352f" />
        <StatCard value={totalOverdue} label="Overdue (14+ days)" color="#e03c3c" icon={<AlertTriangle size={16} />} />
        <StatCard value={totalAwaitingConfirm} label="Awaiting confirmation" color="#9a6700" icon={<Clock size={16} />} />
      </div>

      {/* Filter bar */}
      <div className="filter-bar" style={{ marginBottom: 20 }}>
        <span style={{ fontSize: 13, color: '#787774', marginRight: 4 }}>Filter:</span>
        {(['all', 'logged', 'assigned', 'in_progress', 'contractor_complete'] as const).map(s => (
          <button
            key={s}
            className={`btn ${statusFilter === s ? 'btn-primary' : 'btn-secondary'}`}
            style={{ padding: '4px 12px', fontSize: 13 }}
            onClick={() => setStatusFilter(s)}
          >
            {s === 'all' ? 'All' : s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
          </button>
        ))}
      </div>

      {/* Project accordion */}
      {projectGroups.length === 0 ? (
        <div className="empty-state">
          <p style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>No open maintenance items</p>
          <p style={{ fontSize: 14 }}>All clear! Create maintenance items from the Maintenance page.</p>
          <Link href="/maintenance" className="btn btn-primary" style={{ marginTop: 16 }}>
            Go to Maintenance
          </Link>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {projectGroups.map(({ project, units, totalOpen: count, overdueCount, awaitingConfirm }) => (
            <div key={project.id} style={{ border: '1px solid #e9e9e7', borderRadius: 8, overflow: 'hidden' }}>
              {/* Project header */}
              <button
                onClick={() => toggleProject(project.id)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                  padding: '12px 16px', background: '#f7f7f5', border: 'none', cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                {expandedProjects.has(project.id) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                <span style={{ fontWeight: 600, fontSize: 15, color: '#37352f', flex: 1 }}>{project.name}</span>
                <div style={{ display: 'flex', gap: 12, fontSize: 13, color: '#787774' }}>
                  <span>{count} open</span>
                  {overdueCount > 0 && <span style={{ color: '#e03c3c' }}>{overdueCount} overdue</span>}
                  {awaitingConfirm > 0 && <span style={{ color: '#9a6700' }}>{awaitingConfirm} to confirm</span>}
                </div>
                <Link
                  href={`/projects/${project.id}`}
                  className="btn btn-ghost"
                  style={{ fontSize: 13, padding: '3px 10px', marginLeft: 8 }}
                  onClick={e => e.stopPropagation()}
                >
                  View project
                </Link>
              </button>

              {/* Units */}
              {expandedProjects.has(project.id) && (
                <div style={{ padding: '8px 0' }}>
                  {units.length === 0 ? (
                    <p style={{ padding: '12px 20px', color: '#787774', fontSize: 14 }}>No items match current filter.</p>
                  ) : (
                    units.map(unit => (
                      <div key={unit.unitId} style={{ borderTop: '1px solid #f1f1ef' }}>
                        <button
                          onClick={() => toggleUnit(unit.unitId)}
                          style={{
                            width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                            padding: '10px 20px', background: 'none', border: 'none', cursor: 'pointer',
                            textAlign: 'left',
                          }}
                        >
                          {expandedUnits.has(unit.unitId) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          <span style={{ fontWeight: 500, color: '#37352f' }}>{unit.unitIdentifier}</span>
                          {unit.address && <span style={{ color: '#787774', fontSize: 13 }}>{unit.address}</span>}
                          <span style={{ marginLeft: 'auto', fontSize: 13, color: '#787774' }}>
                            {unit.items.length} item{unit.items.length !== 1 ? 's' : ''}
                          </span>
                        </button>

                        {expandedUnits.has(unit.unitId) && (
                          <div style={{ padding: '0 20px 12px' }}>
                            <table className="data-table">
                              <thead>
                                <tr>
                                  <th>#</th>
                                  <th>Title</th>
                                  <th>Status</th>
                                  <th>Priority</th>
                                  <th>Age</th>
                                  <th>Contractor</th>
                                </tr>
                              </thead>
                              <tbody>
                                {unit.items.map(item => {
                                  const days = getDaysSince(item.created_at)
                                  const ageClass = getAgeClass(item.created_at, AMBER_DAYS, RED_DAYS)
                                  return (
                                    <tr key={item.id} className={ageClass}>
                                      <td style={{ color: '#787774', fontSize: 13 }}>{item.item_number}</td>
                                      <td>
                                        <Link href={`/maintenance/${item.id}`} style={{ color: '#37352f', textDecoration: 'none', fontWeight: 500 }}>
                                          {item.title}
                                        </Link>
                                      </td>
                                      <td><StatusBadge status={item.status} /></td>
                                      <td><PriorityBadge priority={item.priority} /></td>
                                      <td style={{ fontSize: 13, color: days >= RED_DAYS ? '#e03c3c' : days >= AMBER_DAYS ? '#9a6700' : '#787774' }}>
                                        {days}d
                                      </td>
                                      <td style={{ fontSize: 13, color: '#787774' }}>
                                        {(item.contractor as any)?.company_name ?? '—'}
                                      </td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function StatCard({ value, label, color, icon }: { value: number; label: string; color: string; icon?: React.ReactNode }) {
  return (
    <div style={{ background: '#f7f7f5', border: '1px solid #e9e9e7', borderRadius: 8, padding: '16px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        {icon && <span style={{ color }}>{icon}</span>}
        <span style={{ fontSize: 28, fontWeight: 700, color }}>{value}</span>
      </div>
      <p style={{ fontSize: 13, color: '#787774', margin: 0 }}>{label}</p>
    </div>
  )
}
