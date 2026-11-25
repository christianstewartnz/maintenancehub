'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { formatUnitLabel } from '@/lib/utils'

interface Props {
  projects: { id: string; name: string }[]
  contractors: { id: string; company_name: string; contact_name: string | null; email: string | null; portal_token: string }[]
  initialProjectId?: string
  initialContractorId?: string
  initialUnitId?: string
}

/**
 * A work order covers one contractor's items on ONE unit: pick the project and
 * contractor, then the unit, then tick any or all of its open items.
 */
export default function NewWorkOrderClient({ projects, contractors, initialProjectId = '', initialContractorId = '', initialUnitId = '' }: Props) {
  const router = useRouter()
  const supabase = createClient()

  const [projectId, setProjectId] = useState(projects.some(p => p.id === initialProjectId) ? initialProjectId : '')
  const [contractorId, setContractorId] = useState(contractors.some(c => c.id === initialContractorId) ? initialContractorId : '')
  const [unitId, setUnitId] = useState(initialUnitId)
  const [notes, setNotes] = useState('')
  const [availableItems, setAvailableItems] = useState<any[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  // Start "loading" when both are preselected, so the unit check below waits for the fetch.
  const [loadingItems, setLoadingItems] = useState(!!(projectId && contractorId))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!projectId || !contractorId) {
      setAvailableItems([])
      setSelectedIds(new Set())
      return
    }
    setLoadingItems(true)
    supabase
      .from('maintenance_items')
      .select('id, item_number, title, description, status, unit_id, unit:units!inner(id, unit_identifier, address, project_id)')
      .eq('contractor_id', contractorId)
      .eq('unit.project_id', projectId)
      .is('work_order_id', null)
      .is('archived_at', null)
      .not('status', 'in', '("complete")')
      .order('created_at')
      .then(({ data }) => {
        setAvailableItems(data ?? [])
        setLoadingItems(false)
      })
  }, [projectId, contractorId])

  // Units that have at least one available item, in unit order.
  const units = useMemo(() => {
    const map = new Map<string, { unit: any; count: number }>()
    for (const item of availableItems) {
      const u = item.unit as any
      if (!u) continue
      if (!map.has(u.id)) map.set(u.id, { unit: u, count: 0 })
      map.get(u.id)!.count++
    }
    return Array.from(map.values()).sort((a, b) =>
      formatUnitLabel(a.unit).localeCompare(formatUnitLabel(b.unit), undefined, { numeric: true }))
  }, [availableItems])

  // Keep the unit choice valid: auto-pick when there's only one, drop it if it has no items here.
  useEffect(() => {
    if (loadingItems) return
    if (units.length === 1) setUnitId(units[0].unit.id)
    else if (unitId && !units.some(u => u.unit.id === unitId)) setUnitId('')
  }, [units, loadingItems])

  // A new unit starts with nothing ticked.
  useEffect(() => { setSelectedIds(new Set()) }, [unitId, projectId, contractorId])

  const unitItems = useMemo(() => availableItems.filter(i => i.unit_id === unitId), [availableItems, unitId])

  function toggleItem(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selectedIds.size === unitItems.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(unitItems.map(i => i.id)))
    }
  }

  async function handleSave(andSend: boolean) {
    // Only items on the chosen unit (the list is filtered, but be sure).
    const ids = unitItems.filter(i => selectedIds.has(i.id)).map(i => i.id)
    if (!projectId || !contractorId || !unitId || ids.length === 0) return
    setSaving(true)
    setError('')

    const { data: wo, error: woErr } = await supabase
      .from('work_orders')
      .insert({ project_id: projectId, contractor_id: contractorId, notes: notes || null, status: 'draft' })
      .select()
      .single()

    if (woErr || !wo) {
      setError('Failed to create work order.')
      setSaving(false)
      return
    }

    const { error: itemErr } = await supabase
      .from('maintenance_items')
      .update({ work_order_id: wo.id })
      .in('id', ids)
      .eq('unit_id', unitId)

    if (itemErr) {
      setError('Work order created but failed to link some items.')
      setSaving(false)
      router.push(`/work-orders/${wo.id}`)
      return
    }

    if (andSend) {
      const res = await fetch(`/api/work-orders/${wo.id}/send`, { method: 'POST' })
      if (!res.ok) {
        setError('Work order created but email failed to send. You can retry from the detail page.')
        setSaving(false)
        router.push(`/work-orders/${wo.id}`)
        return
      }
    }

    router.push(`/work-orders/${wo.id}`)
  }

  const canSubmit = projectId && contractorId && unitId && selectedIds.size > 0
  const label = { display: 'block', fontSize: 13, fontWeight: 500, color: '#37352f', marginBottom: 6 } as const

  return (
    <div className="page-content" style={{ padding: '24px 32px', maxWidth: 900 }}>
      {/* Project + Contractor selectors */}
      <div className="stack-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div>
          <label style={label}>Project</label>
          <select className="input" value={projectId} onChange={e => setProjectId(e.target.value)}>
            <option value="">Select a project…</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label style={label}>Contractor</label>
          <select className="input" value={contractorId} onChange={e => setContractorId(e.target.value)}>
            <option value="">Select a contractor…</option>
            {contractors.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
          </select>
        </div>
      </div>

      {projectId && contractorId && (
        loadingItems ? (
          <p style={{ color: '#787774', fontSize: 14, marginBottom: 24 }}>Loading items…</p>
        ) : units.length === 0 ? (
          <div className="empty-state" style={{ background: '#f7f7f5', marginBottom: 24 }}>
            <p style={{ fontWeight: 500 }}>No available items</p>
            <p>This contractor has no open maintenance items in this project that aren&apos;t already on a work order.</p>
          </div>
        ) : (
          <>
            {/* Unit selector: a work order covers one unit */}
            <div style={{ marginBottom: 24 }}>
              <label style={label}>
                Unit <span style={{ fontWeight: 400, color: '#787774' }}>(a work order covers one unit)</span>
              </label>
              <select className="input" value={unitId} onChange={e => setUnitId(e.target.value)} style={{ maxWidth: 420 }}>
                <option value="">Select a unit…</option>
                {units.map(({ unit, count }) => (
                  <option key={unit.id} value={unit.id}>{formatUnitLabel(unit)} — {count} item{count !== 1 ? 's' : ''}</option>
                ))}
              </select>
            </div>

            {/* Items on that unit */}
            {unitId && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#37352f' }}>
                    Available Items
                    <span style={{ marginLeft: 8, color: '#787774', fontWeight: 400 }}>({unitItems.length})</span>
                  </h3>
                  {unitItems.length > 1 && (
                    <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={toggleAll}>
                      {selectedIds.size === unitItems.length ? 'Deselect all' : 'Select all'}
                    </button>
                  )}
                </div>
                <div style={{ border: '1px solid #e9e9e7', borderRadius: 8, overflow: 'hidden' }}>
                  <table className="data-table" style={{ marginBottom: 0 }}>
                    <thead>
                      <tr>
                        <th style={{ width: 40 }}></th>
                        <th>#</th>
                        <th>Title</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {unitItems.map(item => {
                        const checked = selectedIds.has(item.id)
                        return (
                          <tr key={item.id} style={{ cursor: 'pointer', background: checked ? '#f0f7ff' : undefined }} onClick={() => toggleItem(item.id)}>
                            <td onClick={e => e.stopPropagation()}>
                              <input type="checkbox" checked={checked} onChange={() => toggleItem(item.id)} style={{ cursor: 'pointer' }} />
                            </td>
                            <td style={{ fontSize: 13, color: '#787774' }}>{item.item_number}</td>
                            <td className="wrap-mobile" style={{ fontWeight: 500 }}>{item.title}</td>
                            <td><StatusBadge status={item.status} /></td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )
      )}

      {/* Notes */}
      {projectId && contractorId && unitId && (
        <div style={{ marginBottom: 24 }}>
          <label style={label}>
            Notes / Instructions <span style={{ fontWeight: 400, color: '#787774' }}>(optional)</span>
          </label>
          <textarea
            className="input"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Add any instructions or notes for the contractor…"
            style={{ minHeight: 90 }}
          />
        </div>
      )}

      {error && <p style={{ color: '#e03131', fontSize: 14, marginBottom: 16 }}>{error}</p>}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn btn-secondary" onClick={() => router.back()} disabled={saving}>Cancel</button>
        <div style={{ flex: 1 }} />
        {selectedIds.size > 0 && (
          <span style={{ fontSize: 13, color: '#787774', alignSelf: 'center' }}>
            {selectedIds.size} item{selectedIds.size !== 1 ? 's' : ''} selected
          </span>
        )}
        <button className="btn btn-secondary" onClick={() => handleSave(false)} disabled={!canSubmit || saving}>
          {saving ? 'Saving…' : 'Save as Draft'}
        </button>
        <button className="btn btn-primary" onClick={() => handleSave(true)} disabled={!canSubmit || saving}>
          {saving ? 'Sending…' : 'Save & Send'}
        </button>
      </div>
    </div>
  )
}
