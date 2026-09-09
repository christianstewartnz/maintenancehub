'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { Plus, Search, X } from 'lucide-react'
import { StatusBadge, PriorityBadge } from '@/components/ui/StatusBadge'
import { getDaysSince, getAgeClass, formatDate } from '@/lib/utils'
import CreateMaintenanceModal from './CreateMaintenanceModal'
import type { MaintenanceItem, MaintenanceStatus, Priority } from '@/lib/types'

interface Props {
  items: MaintenanceItem[]
  projects: { id: string; name: string }[]
  contractors: { id: string; company_name: string }[]
}

export default function MaintenanceClient({ items: initial, projects, contractors }: Props) {
  const [items, setItems] = useState(initial)
  const [showCreate, setShowCreate] = useState(false)
  const [search, setSearch] = useState('')
  const [filterProject, setFilterProject] = useState('')
  const [filterUnit, setFilterUnit] = useState('')
  const [filterStatus, setFilterStatus] = useState<MaintenanceStatus | ''>('')
  const [filterPriority, setFilterPriority] = useState<Priority | ''>('')
  const [filterContractor, setFilterContractor] = useState('')
  const [sortBy, setSortBy] = useState<'created_at' | 'priority' | 'status'>('created_at')

  const unitsForProject = useMemo(() => {
    if (!filterProject) return []
    const seen = new Set<string>()
    const result: { id: string; unit_identifier: string }[] = []
    for (const item of items) {
      const unit = (item.unit as any)
      if (unit?.id && (unit?.project?.id === filterProject || unit?.project_id === filterProject) && !seen.has(unit.id)) {
        seen.add(unit.id)
        result.push({ id: unit.id, unit_identifier: unit.unit_identifier })
      }
    }
    return result.sort((a, b) => a.unit_identifier.localeCompare(b.unit_identifier))
  }, [items, filterProject])

  const filtered = useMemo(() => {
    let result = [...items]
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(i => i.title.toLowerCase().includes(q) || i.description?.toLowerCase().includes(q) || i.item_number.toLowerCase().includes(q))
    }
    if (filterProject) result = result.filter(i => (i.unit as any)?.project?.id === filterProject)
    if (filterUnit) result = result.filter(i => (i.unit as any)?.id === filterUnit)
    if (filterStatus) result = result.filter(i => i.status === filterStatus)
    if (filterPriority) result = result.filter(i => i.priority === filterPriority)
    if (filterContractor) result = result.filter(i => i.contractor_id === filterContractor)

    const PRIORITY_ORDER: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3 }
    const STATUS_ORDER: Record<MaintenanceStatus, number> = { logged: 0, assigned: 1, in_progress: 2, contractor_complete: 3, complete: 4 }

    if (sortBy === 'priority') result.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])
    else if (sortBy === 'status') result.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status])
    else result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

    return result
  }, [items, search, filterProject, filterUnit, filterStatus, filterPriority, filterContractor, sortBy])

  const hasFilters = !!(search || filterProject || filterUnit || filterStatus || filterPriority || filterContractor)

  function clearFilters() {
    setSearch(''); setFilterProject(''); setFilterUnit(''); setFilterStatus(''); setFilterPriority(''); setFilterContractor('')
  }

  function handleCreated(newItem: MaintenanceItem) {
    setItems(prev => [newItem, ...prev])
  }

  return (
    <div className="page-content" style={{ padding: '24px 32px' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 180 }}>
          <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#b0aea8' }} />
          <input className="input" placeholder="Search items…" value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 32 }} />
        </div>
        <select className="input" style={{ flex: '0 0 auto', width: 'auto' }} value={filterProject} onChange={e => { setFilterProject(e.target.value); setFilterUnit('') }}>
          <option value="">All Projects</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {filterProject && (
          <select className="input" style={{ flex: '0 0 auto', width: 'auto' }} value={filterUnit} onChange={e => setFilterUnit(e.target.value)}>
            <option value="">All Units</option>
            {unitsForProject.map(u => <option key={u.id} value={u.id}>{u.unit_identifier}</option>)}
          </select>
        )}
        <select className="input" style={{ flex: '0 0 auto', width: 'auto' }} value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)}>
          <option value="">All Status</option>
          {(['logged','assigned','in_progress','contractor_complete','complete'] as MaintenanceStatus[]).map(s => (
            <option key={s} value={s}>{s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>
          ))}
        </select>
        <select className="input" style={{ flex: '0 0 auto', width: 'auto' }} value={filterPriority} onChange={e => setFilterPriority(e.target.value as any)}>
          <option value="">All Priority</option>
          {(['urgent','high','medium','low'] as Priority[]).map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
        </select>
        <select className="input" style={{ flex: '0 0 auto', width: 'auto' }} value={filterContractor} onChange={e => setFilterContractor(e.target.value)}>
          <option value="">All Contractors</option>
          {contractors.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
        </select>
        <select className="input" style={{ flex: '0 0 auto', width: 'auto' }} value={sortBy} onChange={e => setSortBy(e.target.value as any)}>
          <option value="created_at">Sort: Date</option>
          <option value="priority">Sort: Priority</option>
          <option value="status">Sort: Status</option>
        </select>
        {hasFilters && (
          <button className="btn btn-ghost" style={{ color: '#787774' }} onClick={clearFilters}><X size={15} /> Clear</button>
        )}
        <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setShowCreate(true)}>
          <Plus size={16} /> New Item
        </button>
      </div>

      {/* Active filter chips */}
      {hasFilters && (
        <div className="filter-bar" style={{ marginBottom: 12 }}>
          <span style={{ fontSize: 13, color: '#787774' }}>{filtered.length} result{filtered.length !== 1 ? 's' : ''}</span>
        </div>
      )}

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          {hasFilters ? (
            <>
              <p style={{ fontSize: 15, fontWeight: 500 }}>No items match your filters</p>
              <button className="btn btn-secondary" style={{ marginTop: 12 }} onClick={clearFilters}>Clear filters</button>
            </>
          ) : (
            <>
              <p style={{ fontSize: 15, fontWeight: 500 }}>No maintenance items yet</p>
              <p>Create your first item to get started.</p>
              <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => setShowCreate(true)}><Plus size={16} /> Create Item</button>
            </>
          )}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th><th>Title</th><th>Project</th><th>Unit</th>
                <th>Trade</th><th>Contractor</th><th>Status</th><th>Priority</th>
                <th>Age</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(item => {
                const days = getDaysSince(item.created_at)
                const ageClass = getAgeClass(item.created_at)
                const unit = item.unit as any
                return (
                  <tr key={item.id} className={ageClass}>
                    <td style={{ color: '#787774', fontSize: 13, whiteSpace: 'nowrap' }}>{item.item_number}</td>
                    <td style={{ maxWidth: 240 }}>
                      <Link href={`/maintenance/${item.id}`} style={{ color: '#37352f', textDecoration: 'none', fontWeight: 500 }}>
                        {item.title}
                      </Link>
                    </td>
                    <td style={{ fontSize: 13, color: '#787774', whiteSpace: 'nowrap' }}>{unit?.project?.name ?? '—'}</td>
                    <td style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{unit?.unit_identifier ?? '—'}</td>
                    <td style={{ fontSize: 13, color: '#787774' }}>{(item.trade as any)?.name ?? '—'}</td>
                    <td style={{ fontSize: 13, color: '#787774' }}>{(item.contractor as any)?.company_name ?? '—'}</td>
                    <td><StatusBadge status={item.status} /></td>
                    <td><PriorityBadge priority={item.priority} /></td>
                    <td style={{ fontSize: 13, color: days >= 14 ? '#e03c3c' : days >= 7 ? '#9a6700' : '#787774', whiteSpace: 'nowrap' }}>
                      {days}d
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateMaintenanceModal
          projects={projects}
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  )
}
