'use client'

import { useState, useEffect } from 'react'
import { Plus, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { MaintenanceItem, Priority } from '@/lib/types'

interface LineItem {
  trade_id: string
  title: string
  description: string
  priority: Priority
}

const emptyLine = (): LineItem => ({ trade_id: '', title: '', description: '', priority: 'medium' })

interface Props {
  projects: { id: string; name: string }[]
  onClose: () => void
  onCreated: (item: MaintenanceItem) => void
}

export default function CreateMaintenanceModal({ projects, onClose, onCreated }: Props) {
  const [projectId, setProjectId] = useState('')
  const [unitId, setUnitId] = useState('')
  const [units, setUnits] = useState<{ id: string; unit_identifier: string; address: string | null }[]>([])
  const [trades, setTrades] = useState<{ id: string; name: string }[]>([])
  const [lines, setLines] = useState<LineItem[]>([emptyLine()])
  const [saving, setSaving] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    if (!projectId) { setUnits([]); setTrades([]); setUnitId(''); return }
    setUnitId('')
    Promise.all([
      supabase.from('units').select('id, unit_identifier, address').eq('project_id', projectId).order('unit_identifier'),
      supabase.from('trades').select('id, name').eq('project_id', projectId).order('name'),
    ]).then(([u, t]) => {
      setUnits(u.data ?? [])
      setTrades(t.data ?? [])
    })
  }, [projectId])

  function updateLine(idx: number, field: keyof LineItem, value: string) {
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l))
  }

  function addLine() { setLines(prev => [...prev, emptyLine()]) }
  function removeLine(idx: number) { setLines(prev => prev.filter((_, i) => i !== idx)) }

  const canSubmit = projectId && unitId && lines.some(l => l.title.trim())

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSaving(true)

    for (const line of lines) {
      if (!line.title.trim()) continue
      const { data } = await supabase
        .from('maintenance_items')
        .insert({
          unit_id: unitId,
          trade_id: line.trade_id || null,
          title: line.title.trim(),
          description: line.description.trim() || null,
          priority: line.priority,
        })
        .select(`
          id, item_number, title, status, priority, created_at, updated_at,
          unit:units(id, unit_identifier, address, project_id, project:projects(id, name)),
          trade:trades(id, name),
          contractor:contractors(id, company_name),
          work_order:work_orders(id, work_order_number)
        `)
        .single()
      if (data) onCreated(data as any)
    }

    setSaving(false)
    onClose()
  }

  const selectedUnit = units.find(u => u.id === unitId)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-xl" onClick={e => e.stopPropagation()} style={{ maxHeight: '85vh' }}>
        <div className="modal-header">
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Create Maintenance Items</h2>
          <button className="btn btn-ghost" style={{ padding: '4px 8px' }} onClick={onClose}><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <div className="modal-body" style={{ flex: 1, overflowY: 'auto' }}>

            {/* ── Parent: Project + Unit ── */}
            <div style={{
              background: '#f7f7f5',
              border: '1px solid #e9e9e7',
              borderRadius: 8,
              padding: '16px 18px',
              marginBottom: 24,
            }}>
              <p style={{ margin: '0 0 14px', fontSize: 13, fontWeight: 600, color: '#787774', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Location
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div>
                  <label style={labelStyle}>Project *</label>
                  <select
                    className="input"
                    required
                    value={projectId}
                    onChange={e => setProjectId(e.target.value)}
                  >
                    <option value="">Select a project…</option>
                    {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Unit *</label>
                  <select
                    className="input"
                    required
                    value={unitId}
                    onChange={e => setUnitId(e.target.value)}
                    disabled={!projectId || units.length === 0}
                  >
                    <option value="">
                      {!projectId ? 'Select a project first' : units.length === 0 ? 'No units in this project' : 'Select a unit…'}
                    </option>
                    {units.map(u => (
                      <option key={u.id} value={u.id}>
                        {u.unit_identifier}{u.address ? ` — ${u.address}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {selectedUnit?.address && (
                <p style={{ margin: '10px 0 0', fontSize: 13, color: '#787774' }}>
                  📍 {selectedUnit.address}
                </p>
              )}
            </div>

            {/* ── Items list ── */}
            <div style={{ marginBottom: 8 }}>
              <p style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600, color: '#787774', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Items — all created against the unit above
              </p>
            </div>

            {lines.map((line, idx) => (
              <div key={idx} style={{
                border: '1px solid #e9e9e7',
                borderRadius: 8,
                padding: '14px 16px',
                marginBottom: 10,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: '#787774' }}>Item {idx + 1}</span>
                  {lines.length > 1 && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ padding: '2px 6px', color: '#787774' }}
                      onClick={() => removeLine(idx)}
                    >
                      <X size={15} />
                    </button>
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 120px', gap: 12 }}>
                  <div style={{ gridColumn: 'span 1' }}>
                    <label style={labelStyle}>Title *</label>
                    <input
                      className="input"
                      value={line.title}
                      onChange={e => updateLine(idx, 'title', e.target.value)}
                      placeholder="e.g. Leaking kitchen tap"
                      required={idx === 0}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Trade</label>
                    <select
                      className="input"
                      value={line.trade_id}
                      onChange={e => updateLine(idx, 'trade_id', e.target.value)}
                      disabled={!projectId}
                    >
                      <option value="">Select trade…</option>
                      {trades.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>Priority</label>
                    <select
                      className="input"
                      value={line.priority}
                      onChange={e => updateLine(idx, 'priority', e.target.value as Priority)}
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="urgent">Urgent</option>
                    </select>
                  </div>
                  <div style={{ gridColumn: 'span 3' }}>
                    <label style={labelStyle}>Description</label>
                    <textarea
                      className="input"
                      value={line.description}
                      onChange={e => updateLine(idx, 'description', e.target.value)}
                      placeholder="Detailed description of the issue…"
                      style={{ minHeight: 60 }}
                    />
                  </div>
                </div>
              </div>
            ))}

            <button
              type="button"
              className="btn btn-secondary"
              onClick={addLine}
              disabled={!unitId}
              style={{ marginTop: 4 }}
            >
              <Plus size={15} /> Add Another Item
            </button>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving || !canSubmit}>
              {saving
                ? 'Creating…'
                : `Create ${lines.filter(l => l.title.trim()).length || lines.length} Item${lines.length !== 1 ? 's' : ''}`
              }
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 500,
  marginBottom: 5,
  color: '#37352f',
}
