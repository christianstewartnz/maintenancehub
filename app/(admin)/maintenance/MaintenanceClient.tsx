'use client'

import { useState, useMemo, useEffect, useCallback, Fragment } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, CheckCheck, ChevronDown, ChevronRight, Pencil, Download, Plus, Search, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { getDaysSince, getItemRowClass, formatDate, formatUnitLabel } from '@/lib/utils'
import CreateMaintenanceModal from './CreateMaintenanceModal'
import { LIST_SELECT, type MaintenanceItem, type MaintenanceStatus, type Profile, type ProjectStaff, type StaffProfile } from '@/lib/types'
import { useSessionState } from '@/lib/useSessionState'
import { statusAfterContractorChange } from '@/lib/contractor-notify'
import { ASSIGNEE_ME, ASSIGNEE_UNASSIGNED, fallbackResponsibleLabel, matchesAssignee, profileName } from '@/lib/assignees'
import { primaryContactByProject, projectStaffProfiles } from '@/lib/staff'

const ASSIGNEE_FILTER_KEY = 'maintenance.assigneeFilter'

/** Server renders of the list already shown in this tab (survives client-side navigation). */
const shownRenders = new Set<number>()

interface Props {
  items: MaintenanceItem[]
  projects: { id: string; name: string }[]
  contractors: { id: string; company_name: string }[]
  /** Every profile, for showing names. */
  users: Profile[]
  /** Staff on the user's projects: who can be made Responsible, and each project's main contact. */
  projectStaff: ProjectStaff[]
  trades: { id: string; name: string; project_id: string }[]
  /** Each project's usual contractor per trade, used when a trade is picked. */
  tradeAssignments: { project_id: string; trade_id: string; contractor_id: string }[]
  currentUserId: string
  /** When the server rendered this list (ms). Used to spot a stale copy restored by Back. */
  renderedAt: number
}

export default function MaintenanceClient({ items: initial, projects, contractors, users, projectStaff, trades, tradeAssignments, currentUserId, renderedAt }: Props) {
  const [items, setItems] = useState(initial)
  // Take fresh server data whenever it arrives (e.g. after router.refresh())
  const [seenInitial, setSeenInitial] = useState(initial)
  if (initial !== seenInitial) { setSeenInitial(initial); setItems(initial) }
  const [showCreate, setShowCreate] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [search, setSearch] = useSessionState('maintenance.search', '')
  const [filterProject, setFilterProject] = useSessionState('maintenance.project', '')
  const [filterUnit, setFilterUnit] = useSessionState('maintenance.unit', '')
  // 'archived' is a pseudo-status: shows archived items only (any real status)
  const [filterStatus, setFilterStatus] = useSessionState<MaintenanceStatus | 'archived' | ''>('maintenance.status', '')
  const [filterContractor, setFilterContractor] = useSessionState('maintenance.contractor', '')
  const [filterAssignee, setFilterAssignee] = useState('')
  const [assigning, setAssigning] = useState(false)
  const [bulkAssignee, setBulkAssignee] = useState('')
  const [sortBy, setSortBy] = useSessionState<'created_at' | 'status'>('maintenance.sort', 'created_at')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [completing, setCompleting] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const supabase = createClient()
  const router = useRouter()

  // Everyone on any of my projects, for the per-person filter choices
  const filterUsers = useMemo(() => {
    const seen = new Map<string, StaffProfile>()
    for (const s of projectStaff) if (s.profile?.is_active && !seen.has(s.user_id)) seen.set(s.user_id, s.profile)
    return [...seen.values()].sort((a, b) => profileName(a).localeCompare(profileName(b)))
  }, [projectStaff])

  // Back/forward shows the list as it was when you left it (Next's router cache), which
  // misses changes made since — e.g. steps added or reordered. A server render we've
  // already shown before means this is that cached copy, so fetch a fresh one.
  useEffect(() => {
    if (shownRenders.has(renderedAt)) router.refresh()
    shownRenders.add(renderedAt)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- check once per mount
  }, [])

  // The table scrolls inside its own box, sized to end at the bottom of the screen so its
  // sideways scrollbar is always visible. Record where the box starts (it moves when the
  // filter bar wraps or the bulk-action bar appears); CSS uses it for the max height.
  const tableScrollRef = useCallback((el: HTMLDivElement | null) => {
    const main = el?.closest('main')
    if (!el || !main) return
    const fit = () => {
      const top = el.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop
      el.style.setProperty('--table-top', `${Math.round(top)}px`)
    }
    fit()
    const ro = new ResizeObserver(fit)
    if (el.parentElement) ro.observe(el.parentElement)
    window.addEventListener('resize', fit)
    return () => { ro.disconnect(); window.removeEventListener('resize', fit) }
  }, [])

  // Remember each person's assignee filter on this browser.
  // Read after mount (not in useState's initialiser) so server and client render the same HTML.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(ASSIGNEE_FILTER_KEY)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore from localStorage after hydration
      if (saved && (saved === ASSIGNEE_ME || saved === ASSIGNEE_UNASSIGNED || filterUsers.some(u => u.id === saved))) setFilterAssignee(saved)
    } catch {}
  }, [filterUsers])

  function changeAssigneeFilter(value: string) {
    setFilterAssignee(value)
    try {
      if (value) localStorage.setItem(ASSIGNEE_FILTER_KEY, value)
      else localStorage.removeItem(ASSIGNEE_FILTER_KEY)
    } catch {}
  }

  const userById = useMemo(() => new Map(users.map(u => [u.id, u])), [users])
  const userLabel = (u: Profile) => `${profileName(u)}${u.id === currentUserId ? ' (me)' : ''}`

  // Responsible: an item with no one set falls to its job's person (steps), else the project's main contact
  const contactByProject = useMemo(() => primaryContactByProject(projectStaff), [projectStaff])
  const assignedById = useMemo(() => new Map(items.map(i => [i.id, i.assigned_to ?? null])), [items])
  const fallbackOf = useCallback((item: MaintenanceItem): { id: string | null; fromJob: boolean } => {
    const jobAssigned = item.parent_item_id ? assignedById.get(item.parent_item_id) ?? null : null
    if (jobAssigned) return { id: jobAssigned, fromJob: true }
    return { id: contactByProject.get(projectIdOf(item)) ?? null, fromJob: false }
  }, [assignedById, contactByProject])
  const effectiveOf = useCallback((item: MaintenanceItem) => item.assigned_to || fallbackOf(item).id, [fallbackOf])
  const fallbackLabel = (fb: { id: string | null; fromJob: boolean }) =>
    fallbackResponsibleLabel(fb.id ? userById.get(fb.id) ?? { id: fb.id, email: null, full_name: null } : null, fb.fromJob, currentUserId)

  /** Active staff on a project, main contact first — the people an item there can be given to. */
  const staffFor = useCallback((projectId: string) => projectStaffProfiles(projectStaff, projectId), [projectStaff])

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

  // Trades belong to a project, so each row only offers its own project's trades
  const tradesByProject = useMemo(() => {
    const map = new Map<string, { id: string; name: string }[]>()
    for (const t of trades) {
      const list = map.get(t.project_id) ?? []
      list.push(t)
      map.set(t.project_id, list)
    }
    return map
  }, [trades])

  // Row ids with a trade/contractor save in flight
  const [savingRow, setSavingRow] = useState<Set<string>>(new Set())
  function markSaving(id: string, on: boolean) {
    setSavingRow(prev => { const s = new Set(prev); on ? s.add(id) : s.delete(id); return s })
  }

  async function changeTrade(item: MaintenanceItem, tradeId: string | null) {
    markSaving(item.id, true)
    // Switch to the project's contractor for the new trade (if it has one); otherwise keep the current contractor
    const projectId = (item.unit as any)?.project?.id ?? (item.unit as any)?.project_id
    const defaultContractorId = tradeId
      ? tradeAssignments.find(a => a.project_id === projectId && a.trade_id === tradeId)?.contractor_id ?? null
      : null
    const update: Record<string, unknown> = { trade_id: tradeId }
    let status = item.status
    if (defaultContractorId) {
      update.contractor_id = defaultContractorId
      status = statusAfterContractorChange(item, defaultContractorId)
    }
    const { error } = await supabase.from('maintenance_items').update(update).eq('id', item.id)
    if (error) {
      alert(`Couldn't update trade: ${error.message}`)
    } else {
      const t = tradeId ? trades.find(x => x.id === tradeId) : null
      const c = defaultContractorId ? contractors.find(x => x.id === defaultContractorId) : null
      setItems(prev => prev.map(i => i.id === item.id ? {
        ...i,
        trade_id: tradeId,
        trade: t ? { id: t.id, name: t.name } : null,
        ...(defaultContractorId ? { contractor_id: defaultContractorId, contractor: c ? { id: c.id, company_name: c.company_name } : i.contractor, status } : {}),
      } as MaintenanceItem : i))
      // A step's status feeds its job's status
      if (item.parent_item_id && defaultContractorId) await reloadJob(item.parent_item_id)
    }
    markSaving(item.id, false)
  }

  async function changeContractor(item: MaintenanceItem, contractorId: string | null) {
    markSaving(item.id, true)
    // The item stays Logged until the contractor is notified (DB trigger); mirror that locally
    const status = statusAfterContractorChange(item, contractorId)
    const { error } = await supabase.from('maintenance_items').update({ contractor_id: contractorId }).eq('id', item.id)
    if (error) {
      alert(`Couldn't update contractor: ${error.message}`)
    } else {
      const c = contractorId ? contractors.find(x => x.id === contractorId) : null
      // The DB trigger logs contractor/status changes to the activity feed
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, contractor_id: contractorId, status, contractor: c ? { id: c.id, company_name: c.company_name } : null } as MaintenanceItem : i))
      if (item.parent_item_id && status !== item.status) await reloadJob(item.parent_item_id)
    }
    markSaving(item.id, false)
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
      await reloadJobsOf(ids)
      router.refresh()
    }
    setCompleting(false)
  }

  async function setArchived(ids: string[], archive: boolean) {
    if (!ids.length) return
    const n = `${ids.length} item${ids.length !== 1 ? 's' : ''}`
    if (archive && !confirm(`Archive ${n}? They'll be hidden from lists, the dashboard and the contractor portal. You can restore them from the "Archived" view.`)) return
    setArchiving(true)
    const archived_at = archive ? new Date().toISOString() : null
    const { error } = await supabase.from('maintenance_items').update({ archived_at }).in('id', ids)
    if (error) {
      alert(`Couldn't ${archive ? 'archive' : 'restore'} items: ${error.message}`)
    } else {
      await supabase.from('activity_log').insert(ids.map(id => ({
        maintenance_item_id: id, action: archive ? 'item_archived' : 'item_restored', details: {}, performed_by: 'admin',
      })))
      const set = new Set(ids)
      setItems(prev => prev.map(i => set.has(i.id) ? { ...i, archived_at } : i))
      setSelected(new Set())
      await reloadJobsOf(ids)
      router.refresh()
    }
    setArchiving(false)
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
    // No status chosen = all open items; completed items only show when "Complete" is picked.
    // Archived items only show in the "Archived" view.
    if (filterStatus === 'archived') result = result.filter(i => i.archived_at)
    else {
      result = result.filter(i => !i.archived_at)
      result = filterStatus
        ? result.filter(i => i.status === filterStatus)
        : result.filter(i => i.status !== 'complete')
    }
    // A job split into steps has no contractor by design; its steps carry them
    if (filterContractor === 'none') result = result.filter(i => !i.has_steps && !(i.contractor_id ?? (i.contractor as any)?.id))
    else if (filterContractor) result = result.filter(i => (i.contractor_id ?? (i.contractor as any)?.id) === filterContractor)
    if (filterAssignee) result = result.filter(i => matchesAssignee(i.assigned_to, effectiveOf(i), filterAssignee, currentUserId))

    const STATUS_ORDER: Record<MaintenanceStatus, number> = { logged: 0, assigned: 1, in_progress: 2, contractor_complete: 3, complete: 4 }

    if (sortBy === 'status') result.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status])
    else result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

    return result
  }, [items, search, filterProject, filterUnit, filterStatus, filterContractor, filterAssignee, currentUserId, sortBy, effectiveOf])

  // Only act on selected items that are still visible. Complete items can be selected (to archive them)
  // but "Mark complete" only applies to the ones that aren't complete yet.
  const viewingArchived = filterStatus === 'archived'
  const selectable = filtered
  const selectedVisible = selectable.filter(i => selected.has(i.id)).map(i => i.id)
  const selectedOpen = selectable.filter(i => selected.has(i.id) && i.status !== 'complete').map(i => i.id)
  const allSelected = selectable.length > 0 && selectedVisible.length === selectable.length

  // Bulk Responsible choices: only people on every selected item's project, so no one is
  // given an item they can't see
  const bulkStaff = useMemo(() => {
    const projectIds = [...new Set(items.filter(i => selected.has(i.id)).map(projectIdOf))]
    if (!projectIds.length) return []
    return staffFor(projectIds[0]).filter(u => projectIds.every(pid => staffFor(pid).some(x => x.id === u.id)))
  }, [items, selected, staffFor])

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(selectable.map(i => i.id)))
  }

  // ---- Steps ----
  // A job split into steps shows its steps nested beneath it. A step whose job isn't
  // in the filtered list (e.g. filtering by the step's contractor) shows on its own row.
  const stepsByParent = useMemo(() => {
    const map = new Map<string, MaintenanceItem[]>()
    for (const i of items) {
      if (!i.parent_item_id) continue
      const list = map.get(i.parent_item_id) ?? []
      list.push(i)
      map.set(i.parent_item_id, list)
    }
    for (const list of map.values()) list.sort((a, b) => (a.step_order ?? 0) - (b.step_order ?? 0))
    return map
  }, [items])
  const itemNumberById = useMemo(() => new Map(items.map(i => [i.id, i.item_number])), [items])
  const displayRows = useMemo(() => {
    const ids = new Set(filtered.map(i => i.id))
    return filtered.filter(i => !i.parent_item_id || !ids.has(i.parent_item_id))
  }, [filtered])
  const [collapsedJobs, setCollapsedJobs] = useState<Set<string>>(new Set())
  function toggleJob(id: string) {
    setCollapsedJobs(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }

  /** Re-fetch a job and its steps after a change made through the database (adding a step). */
  async function reloadJob(jobId: string) {
    const { data } = await supabase.from('maintenance_items').select(LIST_SELECT).or(`id.eq.${jobId},parent_item_id.eq.${jobId}`)
    if (!data) return
    const fresh = new Map((data as unknown as MaintenanceItem[]).map(i => [i.id, i]))
    setItems(prev => [...prev.map(i => fresh.get(i.id) ?? i), ...[...fresh.values()].filter(f => !prev.some(i => i.id === f.id))])
  }

  /** After a bulk change: refresh every job touched (a job's steps, or a step's job). */
  async function reloadJobsOf(ids: string[]) {
    const jobIds = new Set<string>()
    for (const id of ids) {
      const i = items.find(x => x.id === id)
      if (i?.has_steps) jobIds.add(i.id)
      if (i?.parent_item_id) jobIds.add(i.parent_item_id)
    }
    await Promise.all([...jobIds].map(reloadJob))
  }

  async function quickAddStep(item: MaintenanceItem, tradeId: string) {
    if (!tradeId) return
    markSaving(item.id, true)
    // The project's contractor for the trade is filled in by the database
    const { error } = await supabase.rpc('add_item_step', { p_parent_id: item.id, p_trade_id: tradeId })
    if (error) alert(`Couldn't add step: ${error.message}`)
    else {
      setCollapsedJobs(prev => { const s = new Set(prev); s.delete(item.id); return s })
      await reloadJob(item.id)
    }
    markSaving(item.id, false)
  }

  /** Move a step earlier/later in its job. Swaps locally straight away, then re-fetches the job. */
  async function moveStep(step: MaintenanceItem, direction: -1 | 1) {
    if (!step.parent_item_id) return
    const siblings = (stepsByParent.get(step.parent_item_id) ?? []).filter(s => !s.archived_at)
    const idx = siblings.findIndex(s => s.id === step.id)
    const other = siblings[idx + direction]
    if (!other) return
    markSaving(step.parent_item_id, true)
    setItems(prev => prev.map(i =>
      i.id === step.id ? { ...i, step_order: other.step_order }
      : i.id === other.id ? { ...i, step_order: step.step_order }
      : i))
    const { error } = await supabase.rpc('move_item_step', { p_step_id: step.id, p_direction: direction })
    if (error) alert(`Couldn't move step: ${error.message}`)
    await reloadJob(step.parent_item_id)
    markSaving(step.parent_item_id, false)
  }

  // ---- Inline edit of a step's heading and instructions ----
  const [editingStep, setEditingStep] = useState<{ id: string; title: string; description: string } | null>(null)
  const [savingStep, setSavingStep] = useState(false)

  function startEditStep(step: MaintenanceItem, jobTitle: string) {
    // A heading equal to the job's is the default, so start the box empty
    setEditingStep({ id: step.id, title: step.title === jobTitle ? '' : step.title, description: step.description ?? '' })
  }

  async function saveStep(step: MaintenanceItem, job: MaintenanceItem) {
    if (!editingStep) return
    setSavingStep(true)
    const title = editingStep.title.trim() || job.title
    const description = editingStep.description.trim() || null
    const { error } = await supabase.from('maintenance_items').update({ title, description }).eq('id', step.id)
    if (error) alert(`Couldn't save step: ${error.message}`)
    else {
      setItems(prev => prev.map(i => i.id === step.id ? { ...i, title, description } : i))
      setEditingStep(null)
      router.refresh()
    }
    setSavingStep(false)
  }

  function renderStepEditor(step: MaintenanceItem, job: MaintenanceItem) {
    if (!editingStep) return null
    return (
      <tr key={`${step.id}-edit`} style={{ background: '#fbfbfa' }}>
        <td />
        <td colSpan={9} style={{ paddingTop: 4, paddingBottom: 12 }}>
          <form className="stack-mobile"
            onSubmit={e => { e.preventDefault(); saveStep(step, job) }}
            onKeyDown={e => { if (e.key === 'Escape') setEditingStep(null) }}
            style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) minmax(240px, 2fr) auto', gap: 8, alignItems: 'start', maxWidth: 1000 }}
          >
            <div>
              <label style={stepEditLabel}>Heading — {step.item_number}</label>
              <input
                className="input"
                autoFocus
                value={editingStep.title}
                onChange={e => setEditingStep(s => s && { ...s, title: e.target.value })}
                placeholder={job.title}
                style={{ fontSize: 13 }}
              />
            </div>
            <div>
              <label style={stepEditLabel}>Instructions for this step</label>
              <textarea
                className="input"
                value={editingStep.description}
                onChange={e => setEditingStep(s => s && { ...s, description: e.target.value })}
                placeholder="Leave blank to use the job's instructions"
                style={{ fontSize: 13, minHeight: 60 }}
              />
            </div>
            <div style={{ display: 'flex', gap: 6, paddingTop: 18 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setEditingStep(null)} disabled={savingStep}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={savingStep}>{savingStep ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </td>
      </tr>
    )
  }

  function renderRow(item: MaintenanceItem, { stepNo, stepCount, jobTitle }: { stepNo?: number; stepCount?: number; jobTitle?: string }) {
    const days = getDaysSince(item.created_at)
    const isComplete = item.status === 'complete'
    const ageClass = getItemRowClass(item)
    const unit = item.unit as any
    const isJob = !!item.has_steps
    const nested = stepNo !== undefined
    const projectTrades = tradesByProject.get(unit?.project?.id ?? unit?.project_id) ?? []
    const jobSteps = isJob ? (stepsByParent.get(item.id) ?? []).filter(s => !s.archived_at) : []
    const stepsDone = jobSteps.filter(s => s.status === 'contractor_complete' || s.status === 'complete').length
    const stepsUnassigned = jobSteps.filter(s => !s.contractor_id).length
    const canAddStep = !item.parent_item_id && !item.archived_at && projectTrades.length > 0

    const addStepPicker = canAddStep && (
      <select
        className="assignee-select"
        value=""
        onChange={e => quickAddStep(item, e.target.value)}
        disabled={savingRow.has(item.id)}
        aria-label={`Add a step to ${item.item_number}`}
        title={isJob ? 'Add another step' : 'Split into steps: the current work becomes step 1'}
        style={{ color: '#b0aea8', fontSize: 12, display: 'block', marginTop: isJob ? 0 : 2 }}
      >
        <option value="">+ step</option>
        {projectTrades.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
    )

    return (
      <tr key={item.id} className={ageClass} style={selected.has(item.id) ? { background: '#f2f7fd' } : nested ? { background: '#fbfbfa' } : undefined}>
        <td style={{ width: 1 }}>
          <input
            type="checkbox"
            aria-label={`Select ${item.item_number}`}
            checked={selected.has(item.id)}
            onChange={() => toggleSelected(item.id)}
            style={checkboxStyle}
          />
        </td>
        <td style={{ color: '#787774', fontSize: 13, whiteSpace: 'nowrap', paddingLeft: nested ? 22 : undefined }}>
          {nested && <span aria-hidden style={{ color: '#c7c6c3', marginRight: 4 }}>↳</span>}
          {item.item_number}
        </td>
        <td className="wrap-mobile" style={{ minWidth: 200, maxWidth: 280 }}>
          {nested ? (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
              <Link href={`/maintenance/${item.id}`} style={{ flex: 1, textDecoration: 'none', fontSize: 13 }}>
                <span style={{ color: '#787774', fontWeight: 500 }}>Step {stepNo}</span>
                {item.title !== jobTitle && <span style={{ color: '#37352f', fontWeight: 500 }}>{' · '}{item.title}</span>}
                <span style={{ display: 'block', color: item.description ? '#37352f' : '#9b9a97' }}>
                  {item.description?.split('\n')[0] ?? 'Same instructions as job'}
                </span>
              </Link>
              {!item.archived_at && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => editingStep?.id === item.id ? setEditingStep(null) : startEditStep(item, jobTitle ?? '')}
                  title="Edit heading and instructions"
                  aria-label={`Edit ${item.item_number}`}
                  style={{ ...stepArrowStyle, padding: '3px 4px', flexShrink: 0 }}
                >
                  <Pencil size={13} />
                </button>
              )}
              {(stepCount ?? 0) > 1 && !item.archived_at && (
                <span style={{ display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => moveStep(item, -1)}
                    disabled={stepNo === 1 || savingRow.has(item.parent_item_id ?? '')}
                    title="Move step up"
                    aria-label={`Move ${item.item_number} up`}
                    style={stepArrowStyle}
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => moveStep(item, 1)}
                    disabled={stepNo === stepCount || savingRow.has(item.parent_item_id ?? '')}
                    title="Move step down"
                    aria-label={`Move ${item.item_number} down`}
                    style={stepArrowStyle}
                  >
                    <ArrowDown size={13} />
                  </button>
                </span>
              )}
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {isJob && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => toggleJob(item.id)}
                    aria-label={collapsedJobs.has(item.id) ? `Show steps of ${item.item_number}` : `Hide steps of ${item.item_number}`}
                    aria-expanded={!collapsedJobs.has(item.id)}
                    style={{ padding: 0, color: '#787774' }}
                  >
                    {collapsedJobs.has(item.id) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  </button>
                )}
                <Link href={`/maintenance/${item.id}`} style={{ color: '#37352f', textDecoration: 'none', fontWeight: 500 }}>
                  {item.title}
                </Link>
              </div>
              {isJob && (
                <div style={{ fontSize: 11, marginTop: 2, paddingLeft: 20, color: '#787774' }}>
                  {jobSteps.length} steps · {stepsDone}/{jobSteps.length} done
                  {stepsUnassigned > 0 && <span style={{ color: '#d9730d', fontWeight: 500 }}> · {stepsUnassigned} need a contractor</span>}
                </div>
              )}
              {item.parent_item_id && (
                <div style={{ fontSize: 11, marginTop: 2, color: '#787774' }}>
                  Step of{' '}
                  <Link href={`/maintenance/${item.parent_item_id}`} style={{ color: '#2383e2', textDecoration: 'none' }}>
                    {itemNumberById.get(item.parent_item_id) ?? 'its job'}
                  </Link>
                </div>
              )}
            </>
          )}
        </td>
        <td style={{ fontSize: 13, color: '#787774', whiteSpace: 'nowrap' }}>{nested ? '' : unit?.project?.name ?? '—'}</td>
        <td style={{ fontSize: 13, color: '#787774', minWidth: 140, maxWidth: 220 }}>{nested ? '' : unit?.address ?? '—'}</td>
        <td style={{ whiteSpace: 'nowrap' }}>
          {isJob ? addStepPicker : (() => {
            const tradeId = item.trade_id ?? (item.trade as any)?.id ?? ''
            return (
              <>
                <select
                  className="assignee-select"
                  value={tradeId}
                  onChange={e => changeTrade(item, e.target.value || null)}
                  disabled={savingRow.has(item.id)}
                  aria-label={`Trade for ${item.item_number}`}
                  style={{ color: tradeId ? '#37352f' : '#b0aea8' }}
                >
                  <option value="">No trade</option>
                  {projectTrades.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  {tradeId && !projectTrades.some(t => t.id === tradeId) && (
                    <option value={tradeId}>{(item.trade as any)?.name ?? 'Unknown trade'}</option>
                  )}
                </select>
                {addStepPicker}
              </>
            )
          })()}
        </td>
        <td style={{ whiteSpace: 'nowrap' }}>
          {isJob ? (
            <span style={{ fontSize: 12, color: '#9b9a97', paddingLeft: 6 }}>On each step</span>
          ) : (() => {
            const contractorId = item.contractor_id ?? (item.contractor as any)?.id ?? ''
            return (
              <select
                className="assignee-select"
                value={contractorId}
                onChange={e => changeContractor(item, e.target.value || null)}
                disabled={savingRow.has(item.id)}
                aria-label={`Contractor for ${item.item_number}`}
                style={{ color: contractorId ? '#37352f' : nested ? '#d9730d' : '#b0aea8' }}
              >
                <option value="">No contractor</option>
                {contractors.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
                {contractorId && !contractors.some(c => c.id === contractorId) && (
                  <option value={contractorId}>{(item.contractor as any)?.company_name ?? 'Unknown contractor'}</option>
                )}
              </select>
            )
          })()}
        </td>
        <td style={{ whiteSpace: 'nowrap' }}>
          {(() => {
            const staff = staffFor(projectIdOf(item))
            const assigned = item.assigned_to
            const assignedUser = assigned ? userById.get(assigned) : undefined
            return (
              <select
                className="assignee-select"
                value={assigned ?? ''}
                onChange={e => assignItems([item.id], e.target.value || null)}
                disabled={assigning}
                aria-label={`Responsible for ${item.item_number}`}
                // Lighter when it's only the fallback (job's person / main contact)
                style={{ color: assigned ? '#37352f' : '#9b9a97', fontWeight: effectiveOf(item) === currentUserId ? 500 : undefined }}
              >
                <option value="">{fallbackLabel(fallbackOf(item))}</option>
                {staff.map(u => <option key={u.id} value={u.id}>{userLabel(u)}</option>)}
                {/* Someone no longer on the project keeps showing until it's changed */}
                {assigned && !staff.some(u => u.id === assigned) && (
                  <option value={assigned}>{assignedUser ? `${userLabel(assignedUser)} (not on project)` : 'Unknown user'}</option>
                )}
              </select>
            )
          })()}
        </td>
        <td><StatusBadge status={item.status} /></td>
        <td style={{ fontSize: 13, color: isComplete ? '#1d6a38' : days >= 14 ? '#e03c3c' : days >= 7 ? '#9a6700' : '#787774', whiteSpace: 'nowrap' }}>
          {nested ? '' : `${days}d`}
        </td>
      </tr>
    )
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
      <div className="toolbar-mobile" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 180 }}>
          <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#b0aea8' }} />
          <input className="input" placeholder="Search items…" value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 32 }} />
        </div>
        <select
          className="input"
          style={{ flex: '0 0 auto', width: 'auto', ...(filterAssignee ? { borderColor: '#2383e2', color: '#2383e2' } : {}) }}
          value={filterAssignee}
          onChange={e => changeAssigneeFilter(e.target.value)}
          aria-label="Filter by who's responsible"
        >
          <option value="">All items</option>
          <option value={ASSIGNEE_ME}>Mine</option>
          {filterUsers.filter(u => u.id !== currentUserId).map(u => <option key={u.id} value={u.id}>{profileName(u)}&apos;s</option>)}
          <option value={ASSIGNEE_UNASSIGNED}>No one set (main contact)</option>
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
          <option value="archived">Archived</option>
        </select>
        <select className="input" style={{ flex: '0 0 auto', width: 'auto' }} value={filterContractor} onChange={e => setFilterContractor(e.target.value)}>
          <option value="">All Contractors</option>
          <option value="none">No contractor</option>
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
          {/* Picking a person only stages the choice; the Set button applies it */}
          <select
            className="input"
            style={{ marginLeft: 'auto', width: 'auto', fontSize: 13 }}
            value={bulkAssignee}
            disabled={assigning}
            aria-label="Set who's responsible for the selected items"
            onChange={e => setBulkAssignee(e.target.value)}
          >
            <option value="">Responsible…</option>
            {bulkStaff.map(u => <option key={u.id} value={u.id}>{userLabel(u)}</option>)}
            <option value={ASSIGNEE_UNASSIGNED}>Clear (back to main contact)</option>
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
                {assigning ? 'Saving…' : `Set for ${selectedVisible.length}`}
              </button>
              <button className="btn btn-ghost" style={{ fontSize: 13, color: '#787774', padding: '4px 8px' }} disabled={assigning} onClick={() => setBulkAssignee('')}>
                Cancel
              </button>
            </>
          )}
          <span aria-hidden style={{ width: 1, alignSelf: 'stretch', background: '#d3e5f8', margin: '0 4px' }} />
          {!viewingArchived && selectedOpen.length > 0 && (
            <button
              className="btn btn-secondary"
              onClick={() => markSelectedComplete(selectedOpen)}
              disabled={completing}
            >
              <CheckCheck size={15} /> {completing ? 'Marking complete…' : `Mark ${selectedOpen.length} complete`}
            </button>
          )}
          <button
            className="btn btn-secondary"
            onClick={() => setArchived(selectedVisible, !viewingArchived)}
            disabled={archiving}
          >
            {viewingArchived
              ? <><ArchiveRestore size={15} /> {archiving ? 'Restoring…' : `Restore ${selectedVisible.length}`}</>
              : <><Archive size={15} /> {archiving ? 'Archiving…' : `Archive ${selectedVisible.length}`}</>}
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
          ) : projects.length === 0 ? (
            // A staff user only sees their projects' items (RLS)
            <>
              <p style={{ fontSize: 15, fontWeight: 500 }}>You haven&apos;t been assigned to any projects yet</p>
              <p>Ask an admin to add you to a project and its items will show here.</p>
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
        <div className="table-scroll" ref={tableScrollRef}>
          <table className="data-table data-table-compact">
            <thead>
              <tr>
                <th style={{ width: 1 }}>
                  <input
                    type="checkbox"
                    aria-label="Select all items"
                    checked={allSelected}
                    ref={el => { if (el) el.indeterminate = selectedVisible.length > 0 && !allSelected }}
                    onChange={toggleAll}
                    disabled={selectable.length === 0}
                    style={checkboxStyle}
                  />
                </th>
                <th>#</th><th>Title</th><th>Project</th><th>Address</th>
                <th>Trade</th><th>Contractor</th><th>Responsible</th><th>Status</th>
                <th>Age</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map(item => (
                <Fragment key={item.id}>
                  {renderRow(item, {})}
                  {item.has_steps && !collapsedJobs.has(item.id) && (stepsByParent.get(item.id) ?? [])
                    .filter(s => viewingArchived ? true : !s.archived_at)
                    .map((s, i, all) => (
                      <Fragment key={s.id}>
                        {renderRow(s, { stepNo: i + 1, stepCount: all.length, jobTitle: item.title })}
                        {editingStep?.id === s.id && renderStepEditor(s, item)}
                      </Fragment>
                    ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateMaintenanceModal
          projects={projects}
          contractors={contractors}
          projectStaff={projectStaff}
          currentUserId={currentUserId}
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  )
}

function projectIdOf(i: MaintenanceItem): string {
  const unit = i.unit as { project_id?: string; project?: { id: string } | null } | null | undefined
  return unit?.project?.id ?? unit?.project_id ?? ''
}

const stepEditLabel: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 500, color: '#787774', marginBottom: 4 }

const stepArrowStyle: React.CSSProperties = { padding: '1px 3px', color: '#9b9a97', lineHeight: 0 }

const checkboxStyle: React.CSSProperties = { width: 16, height: 16, cursor: 'pointer', accentColor: '#2383e2', display: 'block' }
