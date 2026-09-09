'use client'

import { useState, useRef } from 'react'
import Link from 'next/link'
import { Plus, Upload, Download, Trash2, UserPlus, Archive, ArchiveRestore, Pencil } from 'lucide-react'
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

const emptyUnitForm = {
  unit_identifier: '', lot_number: '', address: '', owner_name: '', owner_email: '',
  owner_phone: '', access_contact_name: '', access_contact_email: '', access_contact_phone: '',
  settlement_date: '', notes: '',
}

export default function ProjectDetailClient({ project: initialProject, units: initialUnits, trades: initialTrades, contractors, assignments: initialAssignments, workOrders }: Props) {
  const [project, setProject] = useState(initialProject)
  const [tab, setTab] = useState<Tab>('units')
  const [units, setUnits] = useState(initialUnits)
  const [trades, setTrades] = useState(initialTrades)
  const [assignments, setAssignments] = useState(initialAssignments)
  const [showUnitModal, setShowUnitModal] = useState(false)
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null)
  const [confirmDeleteUnit, setConfirmDeleteUnit] = useState<Unit | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [showAssignModal, setShowAssignModal] = useState<Trade | null>(null)
  const [showAddTradeModal, setShowAddTradeModal] = useState(false)
  const [newTradeName, setNewTradeName] = useState('')
  const [showProjectEditModal, setShowProjectEditModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const router = useRouter()
  const supabase = createClient()
  const fileRef = useRef<HTMLInputElement>(null)

  const [unitForm, setUnitForm] = useState(emptyUnitForm)
  const [projectEditForm, setProjectEditForm] = useState({ name: project.name, address: project.address ?? '', description: project.description ?? '', development_company: project.development_company ?? '' })

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

  function openCreateUnit() {
    setEditingUnit(null)
    setUnitForm(emptyUnitForm)
    setShowUnitModal(true)
  }

  function openEditUnit(unit: Unit) {
    setEditingUnit(unit)
    setUnitForm({
      unit_identifier: unit.unit_identifier,
      lot_number: unit.lot_number ?? '',
      address: unit.address ?? '',
      owner_name: unit.owner_name ?? '',
      owner_email: unit.owner_email ?? '',
      owner_phone: unit.owner_phone ?? '',
      access_contact_name: unit.access_contact_name ?? '',
      access_contact_email: unit.access_contact_email ?? '',
      access_contact_phone: unit.access_contact_phone ?? '',
      settlement_date: unit.settlement_date ?? '',
      notes: unit.notes ?? '',
    })
    setShowUnitModal(true)
  }

  async function handleDeleteUnit() {
    if (!confirmDeleteUnit) return
    setDeleting(true)
    const { error } = await supabase.from('units').delete().eq('id', confirmDeleteUnit.id)
    if (!error) {
      setUnits(u => u.filter(x => x.id !== confirmDeleteUnit.id))
      setConfirmDeleteUnit(null)
    }
    setDeleting(false)
  }

  async function handleSaveUnit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const payload = { ...unitForm, settlement_date: unitForm.settlement_date || null }

    if (editingUnit) {
      const { data, error } = await supabase.from('units').update(payload).eq('id', editingUnit.id).select().single()
      if (!error && data) {
        setUnits(u => u.map(x => x.id === data.id ? data : x))
        setShowUnitModal(false)
      }
    } else {
      const { data, error } = await supabase.from('units').insert({ project_id: project.id, ...payload }).select().single()
      if (!error && data) {
        setUnits(u => [...u, data].sort((a, b) => a.unit_identifier.localeCompare(b.unit_identifier)))
        setShowUnitModal(false)
        setUnitForm(emptyUnitForm)
      }
    }
    setSaving(false)
  }

  async function handleSaveProject(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const { data, error } = await supabase
      .from('projects')
      .update({ name: projectEditForm.name, address: projectEditForm.address || null, description: projectEditForm.description || null, development_company: projectEditForm.development_company || null })
      .eq('id', project.id)
      .select()
      .single()
    if (!error && data) {
      setProject(data)
      setShowProjectEditModal(false)
      router.refresh()
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

  async function handleAddTrade(e: React.FormEvent) {
    e.preventDefault()
    const name = newTradeName.trim()
    if (!name) return
    setSaving(true)
    const { data, error } = await supabase.from('trades').insert({ project_id: project.id, name }).select().single()
    if (!error && data) {
      setTrades(t => [...t, data].sort((a, b) => a.name.localeCompare(b.name)))
      setShowAddTradeModal(false)
      setNewTradeName('')
    }
    setSaving(false)
  }

  return (
    <div style={{ padding: '0 32px 32px' }}>
      {/* Tabs + actions */}
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
        <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
          <button
            className="btn btn-ghost"
            style={{ fontSize: 13, color: '#787774', gap: 6 }}
            onClick={() => { setProjectEditForm({ name: project.name, address: project.address ?? '', description: project.description ?? '', development_company: project.development_company ?? '' }); setShowProjectEditModal(true) }}
          >
            <Pencil size={14} /> Edit Project
          </button>
          <button
            className="btn btn-ghost"
            style={{ fontSize: 13, color: '#787774', gap: 6 }}
            onClick={toggleArchive}
            disabled={archiving}
          >
            {project.status === 'active'
              ? <><Archive size={14} /> {archiving ? 'Archiving…' : 'Archive'}</>
              : <><ArchiveRestore size={14} /> {archiving ? 'Restoring…' : 'Restore'}</>}
          </button>
        </div>
      </div>

      {/* ── Units tab ── */}
      {tab === 'units' && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button className="btn btn-primary" onClick={openCreateUnit}><Plus size={16} /> Add Unit</button>
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
                    <th>Construction No.</th><th>Lot</th><th>Address</th>
                    <th>Owner</th><th>Owner Contact</th><th>Access Contact</th>
                    <th>Settlement</th><th>Maint. Due</th><th></th>
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
                      <td style={{ display: 'flex', gap: 2 }}>
                        <button
                          className="btn btn-ghost"
                          style={{ padding: '3px 6px', color: '#787774' }}
                          onClick={() => openEditUnit(u)}
                          title="Edit unit"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          className="btn btn-ghost"
                          style={{ padding: '3px 6px', color: '#787774' }}
                          onClick={() => setConfirmDeleteUnit(u)}
                          title="Delete unit"
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
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
          <div style={{ marginBottom: 8 }}>
            <button className="btn btn-primary" onClick={() => { setNewTradeName(''); setShowAddTradeModal(true) }}>
              <Plus size={16} /> Add Trade
            </button>
          </div>
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

      {/* Unit modal (create + edit) */}
      {showUnitModal && (
        <div className="modal-overlay" onClick={() => setShowUnitModal(false)}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{editingUnit ? 'Edit Unit' : 'Add Unit'}</h2>
              <button className="btn btn-ghost" style={{ padding: '4px 8px' }} onClick={() => setShowUnitModal(false)}>✕</button>
            </div>
            <form onSubmit={handleSaveUnit}>
              <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <Field label="Construction Number"><input className="input" value={unitForm.unit_identifier} onChange={e => setUnitForm(f => ({ ...f, unit_identifier: e.target.value }))} placeholder="e.g. C001" /></Field>
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
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : editingUnit ? 'Save Changes' : 'Add Unit'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Project edit modal */}
      {showProjectEditModal && (
        <div className="modal-overlay" onClick={() => setShowProjectEditModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Edit Project</h2>
              <button className="btn btn-ghost" style={{ padding: '4px 8px' }} onClick={() => setShowProjectEditModal(false)}>✕</button>
            </div>
            <form onSubmit={handleSaveProject}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <Field label="Project name *" required>
                  <input className="input" required value={projectEditForm.name} onChange={e => setProjectEditForm(f => ({ ...f, name: e.target.value }))} />
                </Field>
                <Field label="Development Company">
                  <input className="input" value={projectEditForm.development_company} onChange={e => setProjectEditForm(f => ({ ...f, development_company: e.target.value }))} placeholder="e.g. Stratum Developments Ltd" />
                </Field>
                <Field label="Address">
                  <input className="input" value={projectEditForm.address} onChange={e => setProjectEditForm(f => ({ ...f, address: e.target.value }))} placeholder="General project address" />
                </Field>
                <Field label="Description">
                  <textarea className="input" value={projectEditForm.description} onChange={e => setProjectEditForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional notes about this project" />
                </Field>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowProjectEditModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add trade modal */}
      {showAddTradeModal && (
        <div className="modal-overlay" onClick={() => setShowAddTradeModal(false)}>
          <div className="modal" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Add Trade</h2>
              <button className="btn btn-ghost" style={{ padding: '4px 8px' }} onClick={() => setShowAddTradeModal(false)}>✕</button>
            </div>
            <form onSubmit={handleAddTrade}>
              <div className="modal-body">
                <Field label="Trade name *" required>
                  <input
                    className="input"
                    required
                    autoFocus
                    value={newTradeName}
                    onChange={e => setNewTradeName(e.target.value)}
                    placeholder="e.g. Irrigation, Pest Control"
                  />
                </Field>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddTradeModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving || !newTradeName.trim()}>
                  {saving ? 'Adding…' : 'Add Trade'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirm delete unit modal */}
      {confirmDeleteUnit && (
        <div className="modal-overlay" onClick={() => setConfirmDeleteUnit(null)}>
          <div className="modal" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Delete Unit</h2>
              <button className="btn btn-ghost" style={{ padding: '4px 8px' }} onClick={() => setConfirmDeleteUnit(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ margin: 0, color: '#37352f' }}>
                Delete <strong>{confirmDeleteUnit.unit_identifier}</strong>
                {confirmDeleteUnit.address ? ` — ${confirmDeleteUnit.address}` : ''}?
              </p>
              <p style={{ margin: '8px 0 0', fontSize: 13, color: '#787774' }}>This cannot be undone. Any maintenance items linked to this unit will also be affected.</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setConfirmDeleteUnit(null)}>Cancel</button>
              <button className="btn btn-primary" style={{ background: '#eb5757', borderColor: '#eb5757' }} onClick={handleDeleteUnit} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Delete Unit'}
              </button>
            </div>
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
