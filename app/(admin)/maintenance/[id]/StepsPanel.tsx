'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowDown, ArrowUp, ListOrdered, Plus, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { STEP_SELECT, type ItemStep, type Trade } from '@/lib/types'

/**
 * A job's steps: each step is a real maintenance item (MI-0166-1, -2, …) with its
 * own instruction, trade, contractor and status, shown in that contractor's portal.
 * Step numbers are fixed; the order can be changed with the arrows.
 */
interface Props {
  item: { id: string; item_number: string; title: string; trade_id: string | null; contractor_id: string | null; has_steps?: boolean; archived_at: string | null }
  /** The item's current trade/contractor names, shown when explaining what becomes step 1. */
  currentTradeName: string | null
  currentContractorName: string | null
  initialSteps: ItemStep[]
  /** Fetch fresh steps on mount (after the job was changed from outside the panel, e.g. signed off). */
  reloadOnMount?: boolean
  trades: Trade[]
  contractors: { id: string; company_name: string }[]
  tradeAssignments: { trade_id: string; contractor_id: string }[]
  /** Called after any change with the job's refreshed fields (status, trade, contractor, has_steps…). */
  onJobChanged: (job: Record<string, unknown>) => void
}

const EMPTY_FORM = { trade_id: '', contractor_id: '', description: '', before: '' }

export default function StepsPanel({ item, currentTradeName, currentContractorName, initialSteps, reloadOnMount, trades, contractors, tradeAssignments, onJobChanged }: Props) {
  const supabase = createClient()
  const [steps, setSteps] = useState<ItemStep[]>(initialSteps)

  useEffect(() => {
    if (!reloadOnMount) return
    supabase.from('maintenance_items').select(STEP_SELECT).eq('parent_item_id', item.id).order('step_order')
      .then(({ data }) => setSteps((data ?? []) as unknown as ItemStep[]))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount (the parent remounts via key)
  }, [])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [busy, setBusy] = useState(false)

  const active = steps.filter(s => !s.archived_at)
  const isSplit = active.length > 0
  const doneCount = active.filter(s => s.status === 'contractor_complete' || s.status === 'complete').length
  const unassigned = active.filter(s => !s.contractor_id).length
  const willMoveCurrentWork = !isSplit && !!(item.trade_id || item.contractor_id)

  async function reload() {
    const [{ data: rows }, { data: job }] = await Promise.all([
      supabase.from('maintenance_items').select(STEP_SELECT).eq('parent_item_id', item.id).order('step_order'),
      supabase.from('maintenance_items')
        .select('status, has_steps, trade_id, contractor_id, scheduled_date, completed_at, work_order_id, trade:trades(id, name), contractor:contractors(id, company_name, contact_name, email, phone)')
        .eq('id', item.id).single(),
    ])
    setSteps((rows ?? []) as unknown as ItemStep[])
    if (job) onJobChanged(job as Record<string, unknown>)
  }

  async function run(action: () => PromiseLike<{ error: { message: string } | null }>, failMsg: string) {
    setBusy(true)
    const { error } = await action()
    if (error) alert(`${failMsg}: ${error.message}`)
    await reload()
    setBusy(false)
    return !error
  }

  function pickTrade(tradeId: string) {
    // Pre-fill the project's contractor for the trade (can still be changed)
    const contractorId = tradeAssignments.find(a => a.trade_id === tradeId)?.contractor_id ?? ''
    setForm(f => ({ ...f, trade_id: tradeId, contractor_id: contractorId }))
  }

  async function addStep(e: React.FormEvent) {
    e.preventDefault()
    // "__first" = ahead of the item's current work, which only becomes step 1 during this call
    const first = form.before === '__first'
    const ok = await run(async () => {
      const res = await supabase.rpc('add_item_step', {
        p_parent_id: item.id,
        p_trade_id: form.trade_id || null,
        p_contractor_id: form.contractor_id || null,
        p_description: form.description.trim() || null,
        p_before_step_id: first ? null : form.before || null,
        p_auto_contractor: false,
      })
      if (res.error || !first) return res
      return supabase.rpc('move_item_step', { p_step_id: res.data as string, p_direction: -1 })
    }, "Couldn't add step")
    if (ok) { setForm(EMPTY_FORM); setShowForm(false) }
  }

  async function updateStep(step: ItemStep, patch: { trade_id?: string | null; contractor_id?: string | null }) {
    const update: Record<string, unknown> = { ...patch }
    if ('trade_id' in patch && patch.trade_id) {
      // New trade: switch to the project's contractor for it, if it has one
      const c = tradeAssignments.find(a => a.trade_id === patch.trade_id)?.contractor_id
      if (c) update.contractor_id = c
    }
    // Status follows the contractor + notify stamp in the DB (stays Logged until notified)
    await run(() => supabase.from('maintenance_items').update(update).eq('id', step.id), "Couldn't update step")
  }

  async function moveStep(step: ItemStep, direction: -1 | 1) {
    await run(() => supabase.rpc('move_item_step', { p_step_id: step.id, p_direction: direction }), "Couldn't move step")
  }

  async function removeStep(step: ItemStep) {
    const [{ count: photos }, { count: notes }] = await Promise.all([
      supabase.from('maintenance_item_attachments').select('id', { count: 'exact', head: true }).eq('maintenance_item_id', step.id),
      supabase.from('contractor_comments').select('id', { count: 'exact', head: true }).eq('maintenance_item_id', step.id),
    ])
    if ((photos ?? 0) + (notes ?? 0) > 0) {
      alert(`${step.item_number} has photos or comments, so it can't be deleted. Open it and archive it instead.`)
      return
    }
    if (!confirm(`Delete step ${step.item_number}${step.trade ? ` (${step.trade.name})` : ''}? ${step.contractor ? `It will disappear from ${step.contractor.company_name}'s portal. ` : ''}This can't be undone.`)) return
    await run(() => supabase.from('maintenance_items').delete().eq('id', step.id), "Couldn't delete step")
  }

  const tradeName = (id: string | null) => trades.find(t => t.id === id)?.name

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: '#37352f', margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          <ListOrdered size={15} /> Steps
        </h3>
        {isSplit && (
          <span style={{ fontSize: 12, color: '#787774' }}>
            {doneCount}/{active.length} done{unassigned > 0 && <span style={{ color: '#d9730d', fontWeight: 500 }}> · {unassigned} without a contractor</span>}
          </span>
        )}
      </div>
      <p style={{ color: '#787774', fontSize: 12, margin: '0 0 12px' }}>
        {isSplit
          ? 'Each step goes to its own contractor and shows in their portal. Later steps see who they’re waiting on.'
          : 'Split this job into steps when it needs more than one trade, e.g. plumber cuts in and straps the pipe, builder makes good, painter finishes.'}
      </p>

      {isSplit && (
        <div style={{ border: '1px solid #e9e9e7', borderRadius: 8, overflow: 'hidden', marginBottom: 10 }}>
          {active.map((s, i) => (
            <div key={s.id} style={{ display: 'grid', gridTemplateColumns: '24px 1fr auto', gap: 10, padding: '10px 12px', borderTop: i ? '1px solid #f1f1ef' : undefined, alignItems: 'start' }}>
              <span style={stepNumStyle}>{i + 1}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                  <Link href={`/maintenance/${s.id}`} style={{ fontSize: 12, color: '#2383e2', textDecoration: 'none' }}>{s.item_number}</Link>
                  <StatusBadge status={s.status} />
                </div>
                <div style={{ fontSize: 13, color: s.description ? '#37352f' : '#9b9a97', marginBottom: 8, whiteSpace: 'pre-wrap' }}>
                  {s.description ?? 'Same instructions as the job'}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <select
                    className="input"
                    aria-label={`Trade for ${s.item_number}`}
                    value={s.trade_id ?? ''}
                    onChange={e => updateStep(s, { trade_id: e.target.value || null })}
                    disabled={busy}
                    style={{ ...inlineSelect, color: s.trade_id ? '#37352f' : '#b0aea8' }}
                  >
                    <option value="">No trade</option>
                    {trades.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  <select
                    className="input"
                    aria-label={`Contractor for ${s.item_number}`}
                    value={s.contractor_id ?? ''}
                    onChange={e => updateStep(s, { contractor_id: e.target.value || null })}
                    disabled={busy}
                    style={{ ...inlineSelect, color: s.contractor_id ? '#37352f' : '#d9730d' }}
                  >
                    <option value="">No contractor</option>
                    {contractors.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <button type="button" className="btn btn-ghost" style={iconBtn} title="Move up" aria-label={`Move ${s.item_number} up`} disabled={busy || i === 0} onClick={() => moveStep(s, -1)}><ArrowUp size={13} /></button>
                <button type="button" className="btn btn-ghost" style={iconBtn} title="Move down" aria-label={`Move ${s.item_number} down`} disabled={busy || i === active.length - 1} onClick={() => moveStep(s, 1)}><ArrowDown size={13} /></button>
                <button type="button" className="btn btn-ghost" style={iconBtn} title="Delete step" aria-label={`Delete ${s.item_number}`} disabled={busy} onClick={() => removeStep(s)}><Trash2 size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!showForm && !item.archived_at && (
        <button type="button" className="btn btn-secondary" style={{ fontSize: 13 }} onClick={() => setShowForm(true)}>
          <Plus size={14} /> {isSplit ? 'Add step' : 'Split into steps'}
        </button>
      )}

      {showForm && (
        <form onSubmit={addStep} style={{ background: '#f7f7f5', border: '1px solid #e9e9e7', borderRadius: 8, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {willMoveCurrentWork && (
            <p style={{ margin: 0, fontSize: 12, color: '#787774' }}>
              The current work{currentTradeName || currentContractorName ? ` (${[currentTradeName, currentContractorName].filter(Boolean).join(' — ')})` : ''} becomes <strong>{item.item_number}-1</strong>, keeping its contractor, status and date. This adds the next step.
            </p>
          )}
          <div className="stack-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <label style={labelStyle}>Trade</label>
              <select className="input" value={form.trade_id} onChange={e => pickTrade(e.target.value)} required>
                <option value="">Choose trade…</option>
                {trades.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Contractor</label>
              <select className="input" value={form.contractor_id} onChange={e => setForm(f => ({ ...f, contractor_id: e.target.value }))}>
                <option value="">No contractor yet</option>
                {contractors.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label style={labelStyle}>Instructions for this step</label>
            <textarea
              className="input"
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="e.g. Make good the access hole in the ceiling. Leave blank to use the job's instructions."
              style={{ minHeight: 60 }}
            />
          </div>
          <div>
            <label style={labelStyle}>Position</label>
            <select className="input" value={form.before} onChange={e => setForm(f => ({ ...f, before: e.target.value }))}>
              <option value="">At the end</option>
              {active.map((s, i) => (
                <option key={s.id} value={s.id}>Before step {i + 1}: {tradeName(s.trade_id) ?? s.item_number}</option>
              ))}
              {willMoveCurrentWork && <option value="__first">Before {currentTradeName ?? 'the current work'} (first)</option>}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary" onClick={() => { setShowForm(false); setForm(EMPTY_FORM) }} disabled={busy}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy || !form.trade_id}>{busy ? 'Adding…' : 'Add step'}</button>
          </div>
        </form>
      )}
    </div>
  )
}

const stepNumStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#787774', background: '#f1f1ef', borderRadius: 12, width: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginTop: 1 }
const inlineSelect: React.CSSProperties = { fontSize: 13, padding: '4px 8px', width: 'auto', minWidth: 150, flex: '1 1 150px' }
const iconBtn: React.CSSProperties = { padding: '3px 5px', color: '#787774' }
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4, color: '#37352f' }
