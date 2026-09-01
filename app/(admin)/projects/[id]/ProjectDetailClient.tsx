'use client'

import { useState, useRef } from 'react'
import Link from 'next/link'
import { Plus, Upload, Download, Trash2, UserPlus, Archive, ArchiveRestore } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { WorkOrderStatusBadge } from '@/components/ui/StatusBadge'
import { formatDate } from '@/lib/utils'
import type { Project, Unit, Trade, Contractor, ProjectTradeAssignment, WorkOrder } from '@/lib/types'

interface Props {
  project: Project
  units: Unit[]
  trades: Trade[]
  contractors: Contractor[]
  assignments: (ProjectTradeAssignment & { trade: Trade; contractor: Contractor })[]
  workOrders: (WorkOrder & { contractor: Contractor })[]
}

type Tab = 'units' | 'trades' | 'work-orders'

export default function ProjectDetailClient({ project: initialProject, units: initialUnits, trades, contractors, assignments: initialAssignments, workOrders }: Props) {
  const [project, setProject] = useState(initialProject)
  const [tab, setTab] = useState<Tab>('units')
  const [units, setUnits] = useState(initialUnits)
  const [assignments, setAssignments] = useState(initialAssignments)
  const [showUnitModal, setShowUnitModal] = useState(false)
  const [showAssignModal, setShowAssignModal] = useState<Trade | null>(null)
  const [saving, setSaving] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const router = useRouter()
  const supabase = createClient()
  const fileRef = useRef<HTMLInputElement>(null)

  async function toggleArchive() {
    setArchiving(true)
    const newStatus = project.status === 'active' ? 'archived' : 'active'
    const { data } = await supabase
      .from('projects')
      .update({ status: newStatus })
      .eq('id', project.id)
      .select()
      .single()
    if (data) setProject(data)
    setArchiving(false)
    router.refresh()
  }

  const [unitForm, setUnitForm] = useState({
    unit_identifier: '', lot_number: '', address: '', owner_name: '', owner_email: '',
    owner_phone: '', access_contact_name: '', access_contact_email: '', access_contact_phone: '',
    settlement_date: '', notes: '',
  })

  function maintenanceDueDate(settlementDate: string | null): string {
    if (!settlementDate) return '—'
    const d = new Date(settlementDate)
    d.setDate(d.getDate() + 90)
    return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  function dueDateStatus(settlementDate: string | null): string {
    if (!settlementDate) return ''
    const due = new Date(settlementDate)
    due.setDate(due.getDate() + 90)
    const days = Math.ceil((due.getTime() - Date.now()) / 86400000)
    if (days < 0) return '#eb5757'
    if (days <= 14) return '#d09c3a'
    return '#787774'
  }

  async function handleCreateUnit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const insertData = { ...unitForm, settlement_date: unitForm.settlement_date || null }
    const { data, error } = await supabase.from('units').insert({ project_id: project.id, ...insertData }).select().single()
    if (!error && data) {
      setUnits(u => [...u, data].sort((a, b) => a.unit_identifier.localeCompare(b.unit_identifier)))
      setShowUnitModal(false)
      setUnitForm({ unit_identifier: '', lot_number: '', address: '', owner_name: '', owner_email: '', owner_phone: '', access_contact_name: '', access_contact_email: '', access_contact_phone: '', settlement_date: '', notes: '' })
    }
    setSaving(false)
  }

  async function handleCsvImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
    const headers = lines[0].split(',').map(h => h.trim())
    const rows = lines.slice(1).map(line => {
      const vals = line.split(',')
      return Object.fromEntries(headers.map((h, i) => [h, vals[i]?.trim() ?? '']))
    })
    const inserts = rows.map(r => ({ project_id: project.id, ...r }))
    await supabase.from('units').insert(inserts)
    router.refresh()
  }

  function downloadTemplate() {
    const csv = 'unit_identifier,lot_number,address,owner_name,owner_email,owner_phone,access_contact_name,access_contact_email,access_contact_phone,settlement_date,notes\n'
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'units-template.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  async function handleAssignContractor(contractorId: string) {
    if (!showAssignModal) return
    setSaving(true)
    const { data } = await supabase
      .from('project_trade_assignments')
      .insert({ project_id: project.id, trade_id: showAssignModal.id, contractor_id: contractorId })
      .select('*, trade:trades(*), contractor:contractors(*)')
      .single()
    if (data) setAssignments(a => [...a, data])
    setShowAssignModal(null)
    setSaving(false)
  }

  async function handleRemoveAssignment(id: string) {
    await supabase.from('project_trade_assignments').delete().eq('id', id)
    setAssignments(a => a.filter(x => x.id !== id))
  }

  return (
    <div style={{ padding: '0 32px 32px' }}>
      {/* Tabs + archive */}
      <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid #e9e9e7', marginBottom: 24, marginTop: 20 }}>
        <div style={{ display: 'flex', gap: 0, flex: 1 }}>
          {(['units', 'trades', 'work-orders'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '10px 20px', background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 14, fontWeight: tab === t ? 600 : 400,
                color: tab === t ? '#37352f' : '#787774',
                borderBottom: tab === t ? '2px solid #37352f' : '2px solid transparent',
                marginBottom: -1,
              }}
            >
              {t === 'units' ? `Units (${units.length})` : t === 'trades' ? `Trades (${trades.length})` : `Work Orders (${workOrders.length})`}
            </button>
          ))}
        </div>
        <button
          className="btn btn-ghost"
          style={{ fontSize: 13, color: '#787774', marginBottom: 4, gap: 6 }}
          onClick={toggleArchive}
          disabled={archiving}
        >
          {project.status === 'active'
            ? <><Archive size={14} /> {archiving ? 'Archiving…' : 'Archive Project'}</>
            : <><ArchiveRestore size={14} /> {archiving ? 'Restoring…' : 'Restore Project'}</>}
        </button>
      </div>

      {/* ── Units tab ── */}
      {tab === 'units' && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button className="btn btn-primary" onClick={() => setShowUnitModal(true)}><Plus size={16} /> Add Unit</button>
            <button className="btn btn-secondary" onClick={downloadTemplate}><Download size={16} /> CSV Template</button>
            <button className="btn btn-secondary" onClick={() => fileRef.current?.click()}><Upload size={16} /> Import CSV</button>
            <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleCsvImport} />
          </div>

          {units.length === 0 ? (
            <div className="empty-state">
              <p style={{ fontSize: 15, fontWeight: 500 }}>No units yet</p>
              <p>Add units manually or import from CSV.</p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Unit ID</th><th>Lot</th><th>Address</th>
                    <th>Owner</th><th>Owner Contact</th><th>Access Contact</th>
                    <th>Settlement</th><th>Maint. Due</th>
                  </tr>
                </thead>
                <tbody>
                  {units.map(u => (
                    <tr key={u.id}>
                      <td style={{ fontWeight: 500 }}>{u.unit_identifier}</td>
                      <td style={{ color: '#787774' }}>{u.lot_number ?? '—'}</td>
                      <td>{u.address ?? '—'}</td>
                      <td>{u.owner_name ?? '—'}</td>
                      <td style={{ fontSize: 13, color: '#787774' }}>{u.owner_email ?? ''}{u.owner_phone ? ` · ${u.owner_phone}` : ''}</td>
                      <td style={{ fontSize: 13, color: '#787774' }}>{u.access_contact_name ?? '—'}</td>
                      <td style={{ fontSize: 13, color: '#787774' }}>{u.settlement_date ? new Date(u.settlement_date).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</td>
                      <td style={{ fontSize: 13, fontWeight: u.settlement_date ? 500 : 400, color: dueDateStatus(u.settlement_date) }}>{maintenanceDueDate(u.settlement_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── Trades tab ── */}
      {tab === 'trades' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {trades.map(trade => {
            const tradeAssignments = assignments.filter(a => a.trade_id === trade.id)
            return (
              <div key={trade.id} style={{ border: '1px solid #e9e9e7', borderRadius: 8, padding: '14px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: tradeAssignments.length > 0 ? 10 : 0 }}>
                  <span style={{ fontWeight: 500, fontSize: 14 }}>{trade.name}</span>
                  <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 13 }} onClick={() => setShowAssignModal(trade)}>
                    <UserPlus size={14} /> Assign Contractor
                  </button>
                </div>
                {tradeAssignments.length > 0 && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {tradeAssignments.map(a => (
                      <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#f1f1ef', borderRadius: 6, padding: '4px 10px', fontSize: 13 }}>
                        <span>{a.contractor?.company_name}</span>
                        <button onClick={() => handleRemoveAssignment(a.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#787774', lineHeight: 1 }}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Work Orders tab ── */}
      {tab === 'work-orders' && (
        <>
          <div style={{ marginBottom: 16 }}>
            <Link href={`/work-orders/new?project=${project.id}`} className="btn btn-primary"><Plus size={16} /> Create Work Order</Link>
          </div>
          {workOrders.length === 0 ? (
            <div className="empty-state"><p>No work orders for this project yet.</p></div>
          ) : (
            <table className="data-table">
              <thead><tr><th>#</th><th>Contractor</th><th>Status</th><th>Created</th><th>Sent</th></tr></thead>
              <tbody>
                {workOrders.map(wo => (
                  <tr key={wo.id}>
                    <td><Link href={`/work-orders/${wo.id}`} style={{ color: '#2383e2', fontWeight: 500 }}>{wo.work_order_number}</Link></td>
                    <td>{wo.contractor?.company_name ?? '—'}</td>
                    <td><WorkOrderStatusBadge status={wo.status} /></td>
                    <td style={{ color: '#787774', fontSize: 13 }}>{formatDate(wo.created_at)}</td>
                    <td style={{ color: '#787774', fontSize: 13 }}>{wo.sent_at ? formatDate(wo.sent_at) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {/* Unit modal */}
      {showUnitModal && (
        <div className="modal-overlay" onClick={() => setShowUnitModal(false)}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Add Unit</h2>
              <button className="btn btn-ghost" style={{ padding: '4px 8px' }} onClick={() => setShowUnitModal(false)}>✕</button>
            </div>
            <form onSubmit={handleCreateUnit}>
              <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <Field label="Unit Identifier *" required><input className="input" required value={unitForm.unit_identifier} onChange={e => setUnitForm(f => ({ ...f, unit_identifier: e.target.value }))} placeholder="e.g. A1" /></Field>
                <Field label="Lot Number"><input className="input" value={unitForm.lot_number} onChange={e => setUnitForm(f => ({ ...f, lot_number: e.target.value }))} placeholder="e.g. Lot 1" /></Field>
                <Field label="Address" style={{ gridColumn: 'span 2' }}><input className="input" value={unitForm.address} onChange={e => setUnitForm(f => ({ ...f, address: e.target.value }))} placeholder="Full unit address" /></Field>
                <Field label="Owner Name"><input className="input" value={unitForm.owner_name} onChange={e => setUnitForm(f => ({ ...f, owner_name: e.target.value }))} /></Field>
                <Field label="Owner Email"><input className="input" type="email" value={unitForm.owner_email} onChange={e => setUnitForm(f => ({ ...f, owner_email: e.target.value }))} /></Field>
                <Field label="Owner Phone"><input className="input" value={unitForm.owner_phone} onChange={e => setUnitForm(f => ({ ...f, owner_phone: e.target.value }))} /></Field>
                <Field label="Access Contact Name"><input className="input" value={unitForm.access_contact_name} onChange={e => setUnitForm(f => ({ ...f, access_contact_name: e.target.value }))} /></Field>
                <Field label="Access Contact Email"><input className="input" type="email" value={unitForm.access_contact_email} onChange={e => setUnitForm(f => ({ ...f, access_contact_email: e.target.value }))} /></Field>
                <Field label="Access Contact Phone"><input className="input" value={unitForm.access_contact_phone} onChange={e => setUnitForm(f => ({ ...f, access_contact_phone: e.target.value }))} /></Field>
                <Field label="Settlement Date" style={{ gridColumn: 'span 2' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <input className="input" type="date" value={unitForm.settlement_date} onChange={e => setUnitForm(f => ({ ...f, settlement_date: e.target.value }))} style={{ flex: 1 }} />
                    {unitForm.settlement_date && (
                      <span style={{ fontSize: 13, color: '#787774', whiteSpace: 'nowrap' }}>
                        Maint. due: <strong style={{ color: '#37352f' }}>{maintenanceDueDate(unitForm.settlement_date)}</strong>
                      </span>
                    )}
                  </div>
                </Field>
                <Field label="Notes" style={{ gridColumn: 'span 2' }}><textarea className="input" value={unitForm.notes} onChange={e => setUnitForm(f => ({ ...f, notes: e.target.value }))} /></Field>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowUnitModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Add Unit'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Assign contractor modal */}
      {showAssignModal && (
        <div className="modal-overlay" onClick={() => setShowAssignModal(null)}>
          <div className="modal" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Assign contractor to {showAssignModal.name}</h2>
              <button className="btn btn-ghost" style={{ padding: '4px 8px' }} onClick={() => setShowAssignModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              {contractors.filter(c => !assignments.some(a => a.trade_id === showAssignModal.id && a.contractor_id === c.id)).length === 0 ? (
                <p style={{ color: '#787774' }}>All contractors already assigned to this trade.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {contractors
                    .filter(c => !assignments.some(a => a.trade_id === showAssignModal.id && a.contractor_id === c.id))
                    .map(c => (
                      <button key={c.id} className="btn btn-secondary" style={{ justifyContent: 'flex-start' }} onClick={() => handleAssignContractor(c.id)}>
                        <div>
                          <div style={{ fontWeight: 500 }}>{c.company_name}</div>
                          {c.contact_name && <div style={{ fontSize: 12, color: '#787774' }}>{c.contact_name}</div>}
                        </div>
                      </button>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, children, required, style }: { label: string; children: React.ReactNode; required?: boolean; style?: React.CSSProperties }) {
  return (
    <div style={style}>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 5, color: '#37352f' }}>
        {label}{required && ' *'}
      </label>
      {children}
    </div>
  )
}
