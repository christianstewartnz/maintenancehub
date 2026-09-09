'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { StatusBadge, PriorityBadge } from '@/components/ui/StatusBadge'
import { formatDate } from '@/lib/utils'

interface Props {
  projects: { id: string; name: string }[]
  contractors: { id: string; company_name: string; contact_name: string | null; email: string | null; portal_token: string }[]
}

export default function NewWorkOrderClient({ projects, contractors }: Props) {
  const router = useRouter()
  const supabase = createClient()

  const [projectId, setProjectId] = useState('')
  const [contractorId, setContractorId] = useState('')
  const [notes, setNotes] = useState('')
  const [availableItems, setAvailableItems] = useState<any[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [loadingItems, setLoadingItems] = useState(false)
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
      .select('id, item_number, title, description, status, priority, unit:units!inner(id, unit_identifier, address, project_id)')
      .eq('contractor_id', contractorId)
      .eq('unit.project_id', projectId)
      .is('work_order_id', null)
      .not('status', 'in', '("complete")')
      .order('created_at')
      .then(({ data }) => {
        setAvailableItems(data ?? [])
        setLoadingItems(false)
      })
  }, [projectId, contractorId])

  function toggleItem(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selectedIds.size === availableItems.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(availableItems.map(i => i.id)))
    }
  }

  async function handleSave(andSend: boolean) {
    if (!projectId || !contractorId || selectedIds.size === 0) return
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
      .in('id', Array.from(selectedIds))

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

  const canSubmit = projectId && contractorId && selectedIds.size > 0

  return (
    <div style={{ padding: '24px 32px', maxWidth: 900 }}>
      {/* Project + Contractor selectors */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        <div>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#37352f', marginBottom: 6 }}>Project</label>
          <select className="input" value={projectId} onChange={e => setProjectId(e.target.value)}>
            <option value="">Select a project…</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#37352f', marginBottom: 6 }}>Contractor</label>
          <select className="input" value={contractorId} onChange={e => setContractorId(e.target.value)}>
            <option value="">Select a contractor…</option>
            {contractors.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
          </select>
        </div>
      </div>

      {/* Items */}
      {projectId && contractorId && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#37352f' }}>
              Available Items
              {availableItems.length > 0 && <span style={{ marginLeft: 8, color: '#787774', fontWeight: 400 }}>({availableItems.length})</span>}
            </h3>
            {availableItems.length > 0 && (
              <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={toggleAll}>
                {selectedIds.size === availableItems.length ? 'Deselect all' : 'Select all'}
              </button>
            )}
          </div>

          {loadingItems ? (
            <p style={{ color: '#787774', fontSize: 14 }}>Loading items…</p>
          ) : availableItems.length === 0 ? (
            <div className="empty-state" style={{ background: '#f7f7f5' }}>
              <p style={{ fontWeight: 500 }}>No available items</p>
              <p>This contractor has no open maintenance items in this project that aren&apos;t already on a work order.</p>
            </div>
          ) : (
            <div style={{ border: '1px solid #e9e9e7', borderRadius: 8, overflow: 'hidden' }}>
              <table className="data-table" style={{ marginBottom: 0 }}>
                <thead>
                  <tr>
                    <th style={{ width: 40 }}></th>
                    <th>#</th>
                    <th>Title</th>
                    <th>Construction No.</th>
                    <th>Status</th>
                    <th>Priority</th>
                  </tr>
                </thead>
                <tbody>
                  {availableItems.map(item => {
                    const unit = item.unit as any
                    const checked = selectedIds.has(item.id)
                    return (
                      <tr key={item.id} style={{ cursor: 'pointer', background: checked ? '#f0f7ff' : undefined }} onClick={() => toggleItem(item.id)}>
                        <td onClick={e => e.stopPropagation()}>
                          <input type="checkbox" checked={checked} onChange={() => toggleItem(item.id)} style={{ cursor: 'pointer' }} />
                        </td>
                        <td style={{ fontSize: 13, color: '#787774' }}>{item.item_number}</td>
                        <td style={{ fontWeight: 500 }}>{item.title}</td>
                        <td style={{ fontSize: 13 }}>
                          {unit?.unit_identifier}
                          {unit?.address && <span style={{ color: '#787774' }}> — {unit.address}</span>}
                        </td>
                        <td><StatusBadge status={item.status} /></td>
                        <td><PriorityBadge priority={item.priority} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Notes */}
      {projectId && contractorId && (
        <div style={{ marginBottom: 24 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#37352f', marginBottom: 6 }}>
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
      <div style={{ display: 'flex', gap: 10 }}>
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
