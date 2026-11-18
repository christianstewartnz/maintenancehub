'use client'

import { useState, useEffect } from 'react'
import { Plus, X, Sparkles, AlertCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { MaintenanceItem, Profile } from '@/lib/types'
import { profileName } from '@/lib/assignees'
import { formatUnitLabel } from '@/lib/utils'

interface LineItem {
  trade_id: string
  contractor_id: string
  title: string
  description: string
}

const emptyLine = (): LineItem => ({ trade_id: '', contractor_id: '', title: '', description: '' })

interface Props {
  projects: { id: string; name: string }[]
  contractors: { id: string; company_name: string }[]
  users: Profile[]
  currentUserId: string
  onClose: () => void
  onCreated: (item: MaintenanceItem) => void
}

export default function CreateMaintenanceModal({ projects, contractors, users, currentUserId, onClose, onCreated }: Props) {
  const [mode, setMode] = useState<'manual' | 'ai'>('manual')
  const [projectId, setProjectId] = useState('')
  const [unitId, setUnitId] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [units, setUnits] = useState<{ id: string; unit_identifier: string | null; address: string | null }[]>([])
  const [trades, setTrades] = useState<{ id: string; name: string }[]>([])
  // trade_id -> contractor_id, from the project's trade assignments
  const [tradeContractor, setTradeContractor] = useState<Record<string, string>>({})
  const [lines, setLines] = useState<LineItem[]>([emptyLine()])
  const [saving, setSaving] = useState(false)
  // AI parse state
  const [aiText, setAiText] = useState('')
  const [aiParsing, setAiParsing] = useState(false)
  const [aiError, setAiError] = useState('')
  const [aiResults, setAiResults] = useState<{ unit_id?: string | null; unit_hint: string | null; title: string; description: string | null; trade_hint: string | null }[]>([])
  const [aiUnitIds, setAiUnitIds] = useState<string[]>([])
  const [aiTradeIds, setAiTradeIds] = useState<string[]>([])
  const [aiContractorIds, setAiContractorIds] = useState<string[]>([])
  const supabase = createClient()

  useEffect(() => {
    if (!projectId) { setUnits([]); setTrades([]); setTradeContractor({}); setUnitId(''); setAiResults([]); return }
    setUnitId('')
    // Trades are per-project, so clear trade/contractor picks when the project changes
    setLines(prev => prev.map(l => ({ ...l, trade_id: '', contractor_id: '' })))
    Promise.all([
      supabase.from('units').select('id, unit_identifier, address').eq('project_id', projectId).order('unit_identifier'),
      supabase.from('trades').select('id, name').eq('project_id', projectId).order('name'),
      supabase.from('project_trade_assignments').select('trade_id, contractor_id').eq('project_id', projectId),
    ]).then(([u, t, a]) => {
      setUnits(u.data ?? [])
      setTrades(t.data ?? [])
      const map: Record<string, string> = {}
      for (const row of (a.data ?? []) as { trade_id: string; contractor_id: string }[]) {
        if (row.trade_id && row.contractor_id && !map[row.trade_id]) map[row.trade_id] = row.contractor_id
      }
      setTradeContractor(map)
    })
  }, [projectId])

  // When AI results arrive, initialise per-item unit/trade selections
  useEffect(() => {
    if (aiResults.length === 0) return
    setAiUnitIds(aiResults.map(r => {
      if (r.unit_id && units.some(u => u.id === r.unit_id)) return r.unit_id
      const hint = r.unit_hint?.toLowerCase()
      const match = hint
        ? units.find(u => u.unit_identifier?.toLowerCase().includes(hint)) ?? units.find(u => u.address?.toLowerCase().includes(hint))
        : undefined
      return match?.id ?? ''
    }))
    const tradeIds = aiResults.map(r => {
      const match = trades.find(t => r.trade_hint && t.name.toLowerCase().includes(r.trade_hint.toLowerCase()))
      return match?.id ?? ''
    })
    setAiTradeIds(tradeIds)
    setAiContractorIds(tradeIds.map(tid => (tid && tradeContractor[tid]) || ''))
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
      const cid = aiContractorIds[i]
      if (!uid) continue
      const { data } = await supabase
        .from('maintenance_items')
        .insert({
          unit_id: uid,
          trade_id: tid || null,
          contractor_id: cid || null,
          status: cid ? 'assigned' : 'logged',
          title: r.title,
          description: r.description || null,
          assigned_to: assignedTo || null,
        })
        .select(`
          id, item_number, title, status, created_at, updated_at, assigned_to, contractor_id,
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

  // Picking a trade pre-fills that trade's contractor for the project, unless a
  // contractor was already chosen by hand (i.e. differs from the old trade's default).
  function updateLineTrade(idx: number, tradeId: string) {
    setLines(prev => prev.map((l, i) => {
      if (i !== idx) return l
      const prevDefault = l.trade_id ? tradeContractor[l.trade_id] ?? '' : ''
      const manual = l.contractor_id && l.contractor_id !== prevDefault
      return { ...l, trade_id: tradeId, contractor_id: manual ? l.contractor_id : (tradeContractor[tradeId] ?? '') }
    }))
  }

  function updateAiTrade(idx: number, tradeId: string) {
    const prevTrade = aiTradeIds[idx]
    const prevDefault = prevTrade ? tradeContractor[prevTrade] ?? '' : ''
    setAiTradeIds(prev => prev.map((v, i) => i === idx ? tradeId : v))
    setAiContractorIds(prev => prev.map((v, i) => {
      if (i !== idx) return v
      const manual = v && v !== prevDefault
      return manual ? v : (tradeContractor[tradeId] ?? '')
    }))
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
          contractor_id: line.contractor_id || null,
          status: line.contractor_id ? 'assigned' : 'logged',
          title: line.title.trim(),
          description: line.description.trim() || null,
          assigned_to: assignedTo || null,
        })
        .select(`
          id, item_number, title, status, created_at, updated_at, assigned_to, contractor_id,
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
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 240px', maxWidth: 320 }}>
                  <label style={sectionLabel}>Project</label>
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
                <div style={{ flex: '1 1 200px', maxWidth: 260 }}>
                  <label style={sectionLabel}>Assign to</label>
                  <select className="input" value={assignedTo} onChange={e => setAssignedTo(e.target.value)}>
                    <option value="">Unassigned (everyone)</option>
                    {users.map(u => (
                      <option key={u.id} value={u.id}>{profileName(u)}{u.id === currentUserId ? ' (me)' : ''}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {mode === 'manual' ? (
              <>
                {/* ── Unit selector ── */}
                <div style={{ marginBottom: 20 }}>
                  <label style={labelStyle}>Unit / Address *</label>
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
                        {formatUnitLabel(u, 'Unnamed unit')}
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
                    <div className="stack-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div style={{ gridColumn: 'span 2' }}>
                        <label style={labelStyle}>Title *</label>
                        <input className="input" value={line.title} onChange={e => updateLine(idx, 'title', e.target.value)} placeholder="e.g. Leaking kitchen tap" required={idx === 0} />
                      </div>
                      <div>
                        <label style={labelStyle}>Trade</label>
                        <select className="input" value={line.trade_id} onChange={e => updateLineTrade(idx, e.target.value)} disabled={!projectId}>
                          <option value="">Select trade…</option>
                          {trades.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={labelStyle}>Contractor</label>
                        <select className="input" value={line.contractor_id} onChange={e => updateLine(idx, 'contractor_id', e.target.value)} disabled={!projectId}>
                          <option value="">Not assigned yet</option>
                          {contractors.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
                        </select>
                      </div>
                      <div style={{ gridColumn: 'span 2' }}>
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
                        <div style={{ marginBottom: 10 }}>
                          <label style={labelStyle}>Title</label>
                          <input
                            className="input"
                            value={r.title}
                            onChange={e => setAiResults(prev => prev.map((x, i) => i === idx ? { ...x, title: e.target.value } : x))}
                          />
                        </div>
                        <div className="stack-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 10 }}>
                          <div>
                            <label style={labelStyle}>Unit / Address *</label>
                            <select className="input" value={aiUnitIds[idx] ?? ''} onChange={e => setAiUnitIds(prev => prev.map((v, i) => i === idx ? e.target.value : v))}>
                              <option value="">Select unit…{r.unit_hint ? ` (AI suggested: ${r.unit_hint})` : ''}</option>
                              {units.map(u => <option key={u.id} value={u.id}>{formatUnitLabel(u, 'Unnamed unit')}</option>)}
                            </select>
                          </div>
                          <div>
                            <label style={labelStyle}>Trade{r.trade_hint ? ` (AI: ${r.trade_hint})` : ''}</label>
                            <select className="input" value={aiTradeIds[idx] ?? ''} onChange={e => updateAiTrade(idx, e.target.value)}>
                              <option value="">Select trade…</option>
                              {trades.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                            </select>
                          </div>
                          <div style={{ gridColumn: 'span 2' }}>
                            <label style={labelStyle}>Contractor</label>
                            <select className="input" value={aiContractorIds[idx] ?? ''} onChange={e => setAiContractorIds(prev => prev.map((v, i) => i === idx ? e.target.value : v))}>
                              <option value="">Not assigned yet</option>
                              {contractors.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
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

const sectionLabel: React.CSSProperties = {
  display: 'block',
  margin: '0 0 8px',
  fontSize: 13,
  fontWeight: 600,
  color: '#787774',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
}
