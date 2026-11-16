'use client'

import { useState, useMemo, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CheckCheck, Download, Plus, Search, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { getDaysSince, getAgeClass, formatDate, formatUnitLabel } from '@/lib/utils'
import CreateMaintenanceModal from './CreateMaintenanceModal'
import type { MaintenanceItem, MaintenanceStatus, Profile } from '@/lib/types'
import { ASSIGNEE_ME, ASSIGNEE_UNASSIGNED, matchesAssignee, profileName } from '@/lib/assignees'

const ASSIGNEE_FILTER_KEY = 'maintenance.assigneeFilter'

interface Props {
  items: MaintenanceItem[]
  projects: { id: string; name: string }[]
  contractors: { id: string; company_name: string }[]
  users: Profile[]
  currentUserId: string
}

export default function MaintenanceClient({ items: initial, projects, contractors, users, currentUserId }: Props) {
  const [items, setItems] = useState(initial)
  const [showCreate, setShowCreate] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [search, setSearch] = useState('')
  const [filterProject, setFilterProject] = useState('')
  const [filterUnit, setFilterUnit] = useState('')
  const [filterStatus, setFilterStatus] = useState<MaintenanceStatus | ''>('')
  const [filterContractor, setFilterContractor] = useState('')
  const [filterAssignee, setFilterAssignee] = useState('')
  const [assigning, setAssigning] = useState(false)
  const [bulkAssignee, setBulkAssignee] = useState('')
  const [sortBy, setSortBy] = useState<'created_at' | 'status'>('created_at')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [completing, setCompleting] = useState(false)
  const supabase = createClient()
  const router = useRouter()

  // Remember each person's assignee filter on this browser.
  // Read after mount (not in useState's initialiser) so server and client render the same HTML.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(ASSIGNEE_FILTER_KEY)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore from localStorage after hydration
      if (saved && (saved === ASSIGNEE_ME || saved === ASSIGNEE_UNASSIGNED || users.some(u => u.id === saved))) setFilterAssignee(saved)
    } catch {}
  }, [users])

  function changeAssigneeFilter(value: string) {
    setFilterAssignee(value)
    try {
      if (value) localStorage.setItem(ASSIGNEE_FILTER_KEY, value)
      else localStorage.removeItem(ASSIGNEE_FILTER_KEY)
    } catch {}
  }

  const userById = useMemo(() => new Map(users.map(u => [u.id, u])), [users])
  const userLabel = (u: Profile) => `${profileName(u)}${u.id === currentUserId ? ' (me)' : ''}`

  async function assignItems(ids: string[], assignedTo: string | null) {
    if (!ids.length) return
    setAssigning(true)
    const { error } = await supabase.from('maintenance_items').update({ assigned_to: assignedTo }).in('id', ids)
    if (error) {
      alert(`Couldn't update assignment: ${error.message}`)
    } else {
      const set = new Set(ids)
      setItems(prev => prev.map(i => set.has(i.id) ? { ...i, assigned_to: assignedTo } : i))
    }
    setAssigning(false)
  }

  function toggleSelected(id: string) {
    setSelected(prev => {
      const s = new Set(prev)
      s.has(id) ? s.delete(id) : s.add(id)
      return s
    })
  }

  async function markSelectedComplete(ids: string[]) {
    if (!ids.length) return
    if (!confirm(`Mark ${ids.length} item${ids.length !== 1 ? 's' : ''} as complete?`)) return
    setCompleting(true)
    const completed_at = new Date().toISOString()
    const { error } = await supabase.from('maintenance_items').update({ status: 'complete', completed_at }).in('id', ids)
    if (error) {
      alert(`Couldn't mark complete: ${error.message}`)
    } else {
      const done = new Set(ids)
      setItems(prev => prev.map(i => done.has(i.id) ? { ...i, status: 'complete', completed_at } : i))
      setSelected(new Set())
      router.refresh()
    }
    setCompleting(false)
  }

  const unitsForProject = useMemo(() => {
    if (!filterProject) return []
    const seen = new Set<string>()
    const result: { id: string; label: string }[] = []
    for (const item of items) {
      const unit = (item.unit as any)
      if (unit?.id && (unit?.project?.id === filterProject || unit?.project_id === filterProject) && !seen.has(unit.id)) {
        seen.add(unit.id)
        result.push({ id: unit.id, label: formatUnitLabel(unit, 'Unnamed unit') })
      }
    }
    return result.sort((a, b) => a.label.localeCompare(b.label))
  }, [items, filterProject])

  const filtered = useMemo(() => {
    let result = [...items]
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(i => i.title?.toLowerCase().includes(q) || i.description?.toLowerCase().includes(q) || i.item_number?.toLowerCase().includes(q)
        || (i.unit as any)?.unit_identifier?.toLowerCase().includes(q) || (i.unit as any)?.address?.toLowerCase().includes(q))
    }
    if (filterProject) result = result.filter(i => (i.unit as any)?.project?.id === filterProject)
    if (filterUnit) result = result.filter(i => (i.unit as any)?.id === filterUnit)
    // No status chosen = all open items; completed items only show when "Complete" is picked
    result = filterStatus
      ? result.filter(i => i.status === filterStatus)
      : result.filter(i => i.status !== 'complete')
    if (filterContractor) result = result.filter(i => (i.contractor_id ?? (i.contractor as any)?.id) === filterContractor)
    if (filterAssignee) result = result.filter(i => matchesAssignee(i.assigned_to, filterAssignee, currentUserId))

    const STATUS_ORDER: Record<MaintenanceStatus, number> = { logged: 0, assigned: 1, in_progress: 2, contractor_complete: 3, complete: 4 }

    if (sortBy === 'status') result.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status])
    else result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

    return result
  }, [items, search, filterProject, filterUnit, filterStatus, filterContractor, filterAssignee, currentUserId, sortBy])

  // Only act on selected items that are still visible and not already complete
  const selectable = filtered.filter(i => i.status !== 'complete')
  const selectedVisible = selectable.filter(i => selected.has(i.id)).map(i => i.id)
  const allSelected = selectable.length > 0 && selectedVisible.length === selectable.length

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(selectable.map(i => i.id)))
  }

  const hasFilters = !!(search || filterProject || filterUnit || filterStatus || filterContractor || filterAssignee)

  function clearFilters() {
    setSearch(''); setFilterProject(''); setFilterUnit(''); setFilterStatus(''); setFilterContractor(''); changeAssigneeFilter('')
  }

  async function handleExport() {
    setExporting(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('q', search)
      if (filterProject) params.set('project', filterProject)
      if (filterUnit) params.set('unit', filterUnit)
      if (filterStatus) params.set('status', filterStatus)
      if (filterContractor) params.set('contractor', filterContractor)
      if (filterAssignee) params.set('assignee', filterAssignee)
      const res = await fetch(`/api/maintenance/export?${params}`)
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        alert(body?.error ?? 'Export failed')
        return
      }
      const disposition = res.headers.get('Content-Disposition') ?? ''
      const match = disposition.match(/filename\*=UTF-8''([^;]+)/)
      const filename = match ? decodeURIComponent(match[1]) : 'Maintenance export.xlsx'
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
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
        <select
          className="input"
          style={{ flex: '0 0 auto', width: 'auto', ...(filterAssignee ? { borderColor: '#2383e2', color: '#2383e2' } : {}) }}
          value={filterAssignee}
          onChange={e => changeAssigneeFilter(e.target.value)}
          aria-label="Filter by assignee"
        >
          <option value="">Everyone&apos;s items</option>
          <option value={ASSIGNEE_ME}>My items + unassigned</option>
          {users.map(u => <option key={u.id} value={u.id}>Only {userLabel(u)}</option>)}
          <option value={ASSIGNEE_UNASSIGNED}>Only unassigned</option>
        </select>
        <select className="input" style={{ flex: '0 0 auto', width: 'auto' }} value={filterProject} onChange={e => { setFilterProject(e.target.value); setFilterUnit('') }}>
          <option value="">All Projects</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {filterProject && (
          <select className="input" style={{ flex: '0 0 auto', width: 'auto' }} value={filterUnit} onChange={e => setFilterUnit(e.target.value)}>
            <option value="">All Units</option>
            {unitsForProject.map(u => <option key={u.id} value={u.id}>{u.label}</option>)}
          </select>
        )}
        <select className="input" style={{ flex: '0 0 auto', width: 'auto' }} value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)}>
          <option value="">All Open</option>
          {(['logged','assigned','in_progress','contractor_complete','complete'] as MaintenanceStatus[]).map(s => (
            <option key={s} value={s}>{s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>
          ))}
        </select>
        <select className="input" style={{ flex: '0 0 auto', width: 'auto' }} value={filterContractor} onChange={e => setFilterContractor(e.target.value)}>
          <option value="">All Contractors</option>
          {contractors.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
        </select>
        <select className="input" style={{ flex: '0 0 auto', width: 'auto' }} value={sortBy} onChange={e => setSortBy(e.target.value as any)}>
          <option value="created_at">Sort: Date</option>
          <option value="status">Sort: Status</option>
        </select>
        {hasFilters && (
          <button className="btn btn-ghost" style={{ color: '#787774' }} onClick={clearFilters}><X size={15} /> Clear</button>
        )}
        <button
          className="btn btn-secondary"
          style={{ marginLeft: 'auto' }}
          onClick={handleExport}
          disabled={exporting || filtered.length === 0}
          title={filterUnit ? 'Export this unit to Excel' : 'Export to Excel — one tab per unit'}
        >
          <Download size={16} /> {exporting ? 'Exporting…' : 'Export'}
        </button>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          <Plus size={16} /> New Item
        </button>
      </div>

      {/* Active filter chips */}
      {hasFilters && (
        <div className="filter-bar" style={{ marginBottom: 12 }}>
          <span style={{ fontSize: 13, color: '#787774' }}>{filtered.length} result{filtered.length !== 1 ? 's' : ''}</span>
        </div>
      )}

      {/* Bulk action bar */}
      {selectedVisible.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, padding: '10px 14px', background: '#f2f7fd', border: '1px solid #d3e5f8', borderRadius: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, fontWeight: 500, color: '#37352f' }}>
            {selectedVisible.length} selected
          </span>
          <button className="btn btn-ghost" style={{ fontSize: 13, color: '#787774', padding: '4px 8px' }} onClick={() => setSelected(new Set())}>
            Clear
          </button>
          {/* Picking a person only stages the choice; the Assign button applies it */}
          <select
            className="input"
            style={{ marginLeft: 'auto', width: 'auto', fontSize: 13 }}
            value={bulkAssignee}
            disabled={assigning}
            aria-label="Assign selected items"
            onChange={e => setBulkAssignee(e.target.value)}
          >
            <option value="">{`Assign ${selectedVisible.length} to…`}</option>
            {users.map(u => <option key={u.id} value={u.id}>{userLabel(u)}</option>)}
            <option value={ASSIGNEE_UNASSIGNED}>Unassigned (everyone)</option>
          </select>
          {bulkAssignee && (
            <>
              <button
                className="btn btn-primary"
                disabled={assigning}
                onClick={async () => {
                  await assignItems(selectedVisible, bulkAssignee === ASSIGNEE_UNASSIGNED ? null : bulkAssignee)
                  setBulkAssignee('')
                }}
              >
                {assigning ? 'Assigning…' : `Assign ${selectedVisible.length}`}
              </button>
              <button className="btn btn-ghost" style={{ fontSize: 13, color: '#787774', padding: '4px 8px' }} disabled={assigning} onClick={() => setBulkAssignee('')}>
                Cancel
              </button>
            </>
          )}
          <span aria-hidden style={{ width: 1, alignSelf: 'stretch', background: '#d3e5f8', margin: '0 4px' }} />
          <button
            className="btn btn-secondary"
            onClick={() => markSelectedComplete(selectedVisible)}
            disabled={completing}
          >
            <CheckCheck size={15} /> {completing ? 'Marking complete…' : `Mark ${selectedVisible.length} complete`}
          </button>
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
                <th style={{ width: 1 }}>
                  <input
                    type="checkbox"
                    aria-label="Select all open items"
                    checked={allSelected}
                    ref={el => { if (el) el.indeterminate = selectedVisible.length > 0 && !allSelected }}
                    onChange={toggleAll}
                    disabled={selectable.length === 0}
                    style={checkboxStyle}
                  />
                </th>
                <th>#</th><th>Title</th><th>Project</th><th>Construction No.</th><th>Address</th>
                <th>Trade</th><th>Contractor</th><th>Assigned to</th><th>Status</th>
                <th>Age</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(item => {
                const days = getDaysSince(item.created_at)
                const isComplete = item.status === 'complete'
                const ageClass = isComplete ? 'row-complete' : getAgeClass(item.created_at)
                const unit = item.unit as any
                return (
                  <tr key={item.id} className={ageClass} style={selected.has(item.id) ? { background: '#f2f7fd' } : undefined}>
                    <td style={{ width: 1 }}>
                      {item.status !== 'complete' && (
                        <input
                          type="checkbox"
                          aria-label={`Select ${item.item_number}`}
                          checked={selected.has(item.id)}
                          onChange={() => toggleSelected(item.id)}
                          style={checkboxStyle}
                        />
                      )}
                    </td>
                    <td style={{ color: '#787774', fontSize: 13, whiteSpace: 'nowrap' }}>{item.item_number}</td>
                    <td style={{ maxWidth: 240 }}>
                      <Link href={`/maintenance/${item.id}`} style={{ color: '#37352f', textDecoration: 'none', fontWeight: 500 }}>
                        {item.title}
                      </Link>
                    </td>
                    <td style={{ fontSize: 13, color: '#787774', whiteSpace: 'nowrap' }}>{unit?.project?.name ?? '—'}</td>
                    <td style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{unit?.unit_identifier ?? '—'}</td>
                    <td style={{ fontSize: 13, color: '#787774', whiteSpace: 'nowrap' }}>{unit?.address ?? '—'}</td>
                    <td style={{ fontSize: 13, color: '#787774' }}>{(item.trade as any)?.name ?? '—'}</td>
                    <td style={{ fontSize: 13, color: '#787774' }}>{(item.contractor as any)?.company_name ?? '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <select
                        className="assignee-select"
                        value={item.assigned_to ?? ''}
                        onChange={e => assignItems([item.id], e.target.value || null)}
                        disabled={assigning}
                        aria-label={`Assign ${item.item_number}`}
                        style={{ color: item.assigned_to ? '#37352f' : '#b0aea8', fontWeight: item.assigned_to === currentUserId ? 500 : undefined }}
                      >
                        <option value="">Unassigned</option>
                        {users.map(u => <option key={u.id} value={u.id}>{userLabel(u)}</option>)}
                        {item.assigned_to && !userById.has(item.assigned_to) && <option value={item.assigned_to}>Unknown user</option>}
                      </select>
                    </td>
                    <td><StatusBadge status={item.status} /></td>
                    <td style={{ fontSize: 13, color: isComplete ? '#1d6a38' : days >= 14 ? '#e03c3c' : days >= 7 ? '#9a6700' : '#787774', whiteSpace: 'nowrap' }}>
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
          contractors={contractors}
          users={users}
          currentUserId={currentUserId}
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  )
}

const checkboxStyle: React.CSSProperties = { width: 16, height: 16, cursor: 'pointer', accentColor: '#2383e2', display: 'block' }
