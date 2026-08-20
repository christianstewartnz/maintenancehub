'use client'

import { useState, useEffect } from 'react'
import { Plus, X, Sparkles, AlertCircle } from 'lucide-react'
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
  const [mode, setMode] = useState<'manual' | 'ai'>('manual')
  const [projectId, setProjectId] = useState('')
  const [unitId, setUnitId] = useState('')
  const [units, setUnits] = useState<{ id: string; unit_identifier: string; address: string | null }[]>([])
  const [trades, setTrades] = useState<{ id: string; name: string }[]>([])
  const [lines, setLines] = useState<LineItem[]>([emptyLine()])
  const [saving, setSaving] = useState(false)
  // AI parse state
  const [aiText, setAiText] = useState('')
  const [aiParsing, setAiParsing] = useState(false)
  const [aiError, setAiError] = useState('')
  const [aiResults, setAiResults] = useState<{ unit_hint: string | null; title: string; description: string | null; trade_hint: string | null; priority: Priority }[]>([])
  const [aiUnitIds, setAiUnitIds] = useState<string[]>([])
  const [aiTradeIds, setAiTradeIds] = useState<string[]>([])
  const supabase = createClient()

  useEffect(() => {
    if (!projectId) { setUnits([]); setTrades([]); setUnitId(''); setAiResults([]); return }
    setUnitId('')
    Promise.all([
      supabase.from('units').select('id, unit_identifier, address').eq('project_id', projectId).order('unit_identifier'),
      supabase.from('trades').select('id, name').eq('project_id', projectId).order('name'),
    ]).then(([u, t]) => {
      setUnits(u.data ?? [])
      setTrades(t.data ?? [])
    })
  }, [projectId])

  // When AI results arrive, initialise per-item unit/trade selections
  useEffect(() => {
    if (aiResults.length === 0) return
    setAiUnitIds(aiResults.map(r => {
      const match = units.find(u => r.unit_hint && u.unit_identifier.toLowerCase().includes(r.unit_hint.toLowerCase()))
      return match?.id ?? ''
    }))
    setAiTradeIds(aiResults.map(r => {
      const match = trades.find(t => r.trade_hint && t.name.toLowerCase().includes(r.trade_hint.toLowerCase()))
      return match?.id ?? ''
    }))
  }, [aiResults])

  async function handleAiParse() {
    if (!aiText.trim()) return
    setAiParsing(true)
    setAiError('')
    setAiResults([])
    const res = await fetch('/api/ai/parse-maintenance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: aiText, units, trades }),
    })
    const json = await res.json()
    setAiParsing(false)
    if (json.error) { setAiError(json.error); return }
    setAiResults(json.items ?? [])
  }

  async function handleAiSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!projectId || aiResults.length === 0) return
    setSaving(true)
    for (let i = 0; i < aiResults.length; i++) {
      const r = aiResults[i]
      const uid = aiUnitIds[i]
      const tid = aiTradeIds[i]
      if (!uid) continue
      const { data } = await supabase
        .from('maintenance_items')
        .insert({
          unit_id: uid,
          trade_id: tid || null,
          title: r.title,
          description: r.description || null,
          priority: r.priority,
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
      <div className="modal modal-xl" onClick={e => e.stopPropagation()} style={{ maxHeight: '90vh' }}>
        <div className="modal-header">
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Create Maintenance Items</h2>
          <button className="btn btn-ghost" style={{ padding: '4px 8px' }} onClick={onClose}><X size={18} /></button>
        </div>

        {/* Mode tabs */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #e9e9e7', padding: '0 24px' }}>
          {(['manual', 'ai'] as const).map(m => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              style={{
                padding: '10px 16px',
                border: 'none',
                borderBottom: mode === m ? '2px solid #2383e2' : '2px solid transparent',
                background: 'none',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 500,
                color: mode === m ? '#2383e2' : '#787774',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {m === 'ai' && <Sparkles size={14} />}
              {m === 'manual' ? 'Manual entry' : 'Parse from text'}
            </button>
          ))}
        </div>

        <form onSubmit={mode === 'ai' ? handleAiSubmit : handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <div className="modal-body" style={{ flex: 1, overflowY: 'auto' }}>

            {/* ── Project selector (always visible) ── */}
            <div style={{ background: '#f7f7f5', border: '1px solid #e9e9e7', borderRadius: 8, padding: '16px 18px', marginBottom: 20 }}>
              <p style={{ margin: '0 0 14px', fontSize: 13, fontWeight: 600, color: '#787774', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Project</p>
              <select
                className="input"
                required
                value={projectId}
                onChange={e => setProjectId(e.target.value)}
                style={{ maxWidth: 320 }}
              >
                <option value="">Select a project…</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>

            {mode === 'manual' ? (
              <>
                {/* ── Unit selector ── */}
                <div style={{ marginBottom: 20 }}>
                  <label style={labelStyle}>Unit *</label>
                  <select
                    className="input"
                    required
                    value={unitId}
                    onChange={e => setUnitId(e.target.value)}
                    disabled={!projectId || units.length === 0}
                    style={{ maxWidth: 320 }}
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

                {/* ── Items list ── */}
                <p style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600, color: '#787774', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Items — all created against the unit above
                </p>

                {lines.map((line, idx) => (
                  <div key={idx} style={{ border: '1px solid #e9e9e7', borderRadius: 8, padding: '14px 16px', marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <span style={{ fontSize: 13, fontWeight: 500, color: '#787774' }}>Item {idx + 1}</span>
                      {lines.length > 1 && (
                        <button type="button" className="btn btn-ghost" style={{ padding: '2px 6px', color: '#787774' }} onClick={() => removeLine(idx)}>
                          <X size={15} />
                        </button>
                      )}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 120px', gap: 12 }}>
                      <div style={{ gridColumn: 'span 1' }}>
                        <label style={labelStyle}>Title *</label>
                        <input className="input" value={line.title} onChange={e => updateLine(idx, 'title', e.target.value)} placeholder="e.g. Leaking kitchen tap" required={idx === 0} />
                      </div>
                      <div>
                        <label style={labelStyle}>Trade</label>
                        <select className="input" value={line.trade_id} onChange={e => updateLine(idx, 'trade_id', e.target.value)} disabled={!projectId}>
                          <option value="">Select trade…</option>
                          {trades.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={labelStyle}>Priority</label>
                        <select className="input" value={line.priority} onChange={e => updateLine(idx, 'priority', e.target.value as Priority)}>
                          <option value="low">Low</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                          <option value="urgent">Urgent</option>
                        </select>
                      </div>
                      <div style={{ gridColumn: 'span 3' }}>
                        <label style={labelStyle}>Description</label>
                        <textarea className="input" value={line.description} onChange={e => updateLine(idx, 'description', e.target.value)} placeholder="Detailed description of the issue…" style={{ minHeight: 60 }} />
                      </div>
                    </div>
                  </div>
                ))}

                <button type="button" className="btn btn-secondary" onClick={addLine} disabled={!unitId} style={{ marginTop: 4 }}>
                  <Plus size={15} /> Add Another Item
                </button>
              </>
            ) : (
              <>
                {/* ── AI parse mode ── */}
                <p style={{ margin: '0 0 8px', fontSize: 14, color: '#787774' }}>
                  Paste or type a maintenance report. Claude will extract individual items, match units and trades, and pre-fill them for review.
                </p>

                <textarea
                  className="input"
                  value={aiText}
                  onChange={e => setAiText(e.target.value)}
                  placeholder="e.g. Unit 4 has a leaking bathroom tap. Unit 12 needs the kitchen fan replaced — it's making a grinding noise. Also unit 7 has a broken window lock."
                  style={{ minHeight: 120, marginBottom: 12 }}
                  disabled={!projectId}
                />

                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleAiParse}
                  disabled={!projectId || !aiText.trim() || aiParsing}
                  style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <Sparkles size={14} />
                  {aiParsing ? 'Parsing…' : 'Parse with AI'}
                </button>

                {aiError && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: '#fff5f5', border: '1px solid #feb2b2', borderRadius: 6, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#c53030' }}>
                    <AlertCircle size={15} style={{ marginTop: 1, flexShrink: 0 }} />
                    {aiError}
                  </div>
                )}

                {aiResults.length > 0 && (
                  <>
                    <p style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600, color: '#787774', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {aiResults.length} item{aiResults.length !== 1 ? 's' : ''} found — confirm details
                    </p>
                    {aiResults.map((r, idx) => (
                      <div key={idx} style={{ border: '1px solid #e9e9e7', borderRadius: 8, padding: '14px 16px', marginBottom: 10 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 10 }}>
                          <div>
                            <label style={labelStyle}>Title</label>
                            <input
                              className="input"
                              value={r.title}
                              onChange={e => setAiResults(prev => prev.map((x, i) => i === idx ? { ...x, title: e.target.value } : x))}
                            />
                          </div>
                          <div>
                            <label style={labelStyle}>Priority</label>
                            <select className="input" value={r.priority} onChange={e => setAiResults(prev => prev.map((x, i) => i === idx ? { ...x, priority: e.target.value as Priority } : x))}>
                              <option value="low">Low</option>
                              <option value="medium">Medium</option>
                              <option value="high">High</option>
                              <option value="urgent">Urgent</option>
                            </select>
                          </div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 10 }}>
                          <div>
                            <label style={labelStyle}>Unit *</label>
                            <select className="input" value={aiUnitIds[idx] ?? ''} onChange={e => setAiUnitIds(prev => prev.map((v, i) => i === idx ? e.target.value : v))}>
                              <option value="">Select unit…{r.unit_hint ? ` (AI suggested: ${r.unit_hint})` : ''}</option>
                              {units.map(u => <option key={u.id} value={u.id}>{u.unit_identifier}{u.address ? ` — ${u.address}` : ''}</option>)}
                            </select>
                          </div>
                          <div>
                            <label style={labelStyle}>Trade{r.trade_hint ? ` (AI: ${r.trade_hint})` : ''}</label>
                            <select className="input" value={aiTradeIds[idx] ?? ''} onChange={e => setAiTradeIds(prev => prev.map((v, i) => i === idx ? e.target.value : v))}>
                              <option value="">Select trade…</option>
                              {trades.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                            </select>
                          </div>
                        </div>
                        {r.description && (
                          <div>
                            <label style={labelStyle}>Description</label>
                            <textarea className="input" value={r.description ?? ''} onChange={e => setAiResults(prev => prev.map((x, i) => i === idx ? { ...x, description: e.target.value } : x))} style={{ minHeight: 56 }} />
                          </div>
                        )}
                      </div>
                    ))}
                  </>
                )}
              </>
            )}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            {mode === 'manual' ? (
              <button type="submit" className="btn btn-primary" disabled={saving || !canSubmit}>
                {saving ? 'Creating…' : `Create ${lines.filter(l => l.title.trim()).length || lines.length} Item${lines.length !== 1 ? 's' : ''}`}
              </button>
            ) : (
              <button type="submit" className="btn btn-primary" disabled={saving || aiResults.length === 0 || aiResults.every((_, i) => !aiUnitIds[i])}>
                {saving ? 'Creating…' : aiResults.length > 0 ? `Create ${aiResults.length} Item${aiResults.length !== 1 ? 's' : ''}` : 'Parse text first'}
              </button>
            )}
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
