'use client'

import { useState, useMemo } from 'react'
import { StatusBadge, PriorityBadge } from '@/components/ui/StatusBadge'
import { formatDateTime } from '@/lib/utils'
import type { MaintenanceStatus } from '@/lib/types'
import { ChevronDown, ChevronUp, MessageSquare, FileText, Wrench, User, Phone, MapPin, Paperclip, Calendar } from 'lucide-react'

interface Props {
  contractor: { id: string; company_name: string; contact_name: string | null }
  items: any[]
  token: string
}

type Tab = 'maintenance' | 'work_orders'

const WO_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  sent: 'Sent',
  in_progress: 'In Progress',
  complete: 'Complete',
}
const WO_STATUS_STYLE: Record<string, { background: string; color: string }> = {
  draft:       { background: '#f0f0ee', color: '#787774' },
  sent:        { background: '#eef4ff', color: '#2f6fcf' },
  in_progress: { background: '#fff8e6', color: '#c97d0a' },
  complete:    { background: '#e8f5e9', color: '#2e7d32' },
}

// ---------- Item accordion ----------
interface ItemProps {
  item: any
  isExpanded: boolean
  onToggle: () => void
  comment: string
  onComment: (v: string) => void
  onSubmitComment: () => void
  onUpdateStatus: (s: MaintenanceStatus) => void
  onSetScheduledDate: (date: string) => void
  isStatusSubmitting: boolean
  isCommentSubmitting: boolean
  isDateSubmitting: boolean
}

function ItemRow({
  item, isExpanded, onToggle,
  comment, onComment, onSubmitComment,
  onUpdateStatus, onSetScheduledDate,
  isStatusSubmitting, isCommentSubmitting, isDateSubmitting,
}: ItemProps) {
  const [localDate, setLocalDate] = useState(item.scheduled_date ?? '')
  return (
    <div style={{ border: '1px solid #e9e9e7', borderRadius: 6, overflow: 'hidden', background: 'white' }}>
      {/* Row */}
      <div
        onClick={onToggle}
        style={{ padding: '11px 14px', cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'center' }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 3 }}>
            <span style={{ fontSize: 11, color: '#a0a09e' }}>{item.item_number}</span>
            <StatusBadge status={item.status} />
            <PriorityBadge priority={item.priority} />
            {item.work_order && (
              <span style={{
                fontSize: 11, fontWeight: 600, color: '#2f6fcf',
                background: '#eef4ff', borderRadius: 4, padding: '1px 6px',
              }}>
                {item.work_order.work_order_number}
              </span>
            )}
            {item.comments?.length > 0 && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, color: '#a0a09e' }}>
                <MessageSquare size={11} /> {item.comments.length}
              </span>
            )}
            {item.attachments?.length > 0 && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, color: '#a0a09e' }}>
                <Paperclip size={11} /> {item.attachments.length}
              </span>
            )}
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#37352f' }}>{item.title}</div>
        </div>
        <div style={{ color: '#a0a09e', flexShrink: 0 }}>
          {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </div>
      </div>

      {/* Expanded detail — no site access here, that lives on the unit */}
      {isExpanded && (
        <div style={{ borderTop: '1px solid #f0f0ee', padding: '14px 14px' }}>
          {item.description && (
            <p style={{ margin: '0 0 14px', fontSize: 14, color: '#37352f', whiteSpace: 'pre-wrap' }}>{item.description}</p>
          )}

          {item.attachments?.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#787774', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Attachments
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {item.attachments.map((att: any) => {
                  const isImage = att.file_type?.startsWith('image/')
                  return (
                    <a
                      key={att.id}
                      href={att.file_url}
                      target="_blank"
                      rel="noreferrer noopener"
                      style={{ display: 'block', textDecoration: 'none' }}
                    >
                      {isImage ? (
                        <img
                          src={att.file_url}
                          alt={att.file_name}
                          style={{
                            width: 100, height: 100, objectFit: 'cover',
                            borderRadius: 6, border: '1px solid #e9e9e7',
                          }}
                        />
                      ) : (
                        <div style={{
                          width: 100, height: 100, borderRadius: 6,
                          border: '1px solid #e9e9e7', background: '#f7f7f5',
                          display: 'flex', flexDirection: 'column', alignItems: 'center',
                          justifyContent: 'center', gap: 6, padding: 8,
                        }}>
                          <Paperclip size={20} style={{ color: '#a0a09e' }} />
                          <span style={{ fontSize: 10, color: '#787774', textAlign: 'center', wordBreak: 'break-all', lineHeight: 1.3 }}>
                            {att.file_name}
                          </span>
                        </div>
                      )}
                    </a>
                  )
                })}
              </div>
            </div>
          )}

          {(item.status === 'assigned' || item.status === 'in_progress') && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
              {item.status === 'assigned' && (
                <button className="btn btn-secondary" disabled={isStatusSubmitting} onClick={() => onUpdateStatus('in_progress')}>
                  Mark as In Progress
                </button>
              )}
              <button className="btn btn-primary" disabled={isStatusSubmitting} onClick={() => onUpdateStatus('contractor_complete')}>
                {isStatusSubmitting ? 'Updating…' : 'Mark Complete'}
              </button>
            </div>
          )}

          {/* Scheduled date */}
          <div style={{ marginBottom: 16, padding: '10px 12px', background: '#f7f7f5', borderRadius: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <Calendar size={13} style={{ color: '#787774' }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: '#37352f' }}>Booked Date</span>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="date"
                value={localDate}
                onChange={e => setLocalDate(e.target.value)}
                style={{ flex: 1, padding: '6px 10px', fontSize: 13, border: '1px solid #e9e9e7', borderRadius: 6, background: 'white' }}
              />
              <button
                className="btn btn-primary"
                style={{ padding: '6px 12px', fontSize: 13, whiteSpace: 'nowrap' }}
                disabled={isDateSubmitting || localDate === (item.scheduled_date ?? '')}
                onClick={() => onSetScheduledDate(localDate)}
              >
                {isDateSubmitting ? '…' : 'Save'}
              </button>
            </div>
            {item.scheduled_date && (
              <p style={{ margin: '6px 0 0', fontSize: 12, color: '#787774' }}>
                Currently booked: {new Date(item.scheduled_date + 'T00:00:00').toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
              </p>
            )}
          </div>

          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Comments</div>
          {(item.comments ?? []).map((c: any) => (
            <div key={c.id} style={{ background: '#f7f7f5', borderRadius: 6, padding: '8px 12px', marginBottom: 8 }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 3, fontSize: 12 }}>
                <span style={{ fontWeight: 500 }}>{c.author}</span>
                <span style={{ color: '#787774' }}>{formatDateTime(c.created_at)}</span>
              </div>
              <p style={{ margin: 0, fontSize: 13 }}>{c.content}</p>
            </div>
          ))}
          <textarea
            className="input"
            placeholder="Add a comment…"
            value={comment}
            onChange={e => onComment(e.target.value)}
            style={{ minHeight: 56, marginTop: 8 }}
          />
          <button
            className="btn btn-secondary"
            style={{ marginTop: 8 }}
            onClick={onSubmitComment}
            disabled={!comment.trim() || isCommentSubmitting}
          >
            {isCommentSubmitting ? 'Posting…' : 'Post Comment'}
          </button>
        </div>
      )}
    </div>
  )
}

// ---------- Main component ----------
export default function PortalClient({ contractor, items: initial, token }: Props) {
  const [items, setItems] = useState(initial)
  const [activeTab, setActiveTab] = useState<Tab>('maintenance')
  const [expandedUnits, setExpandedUnits] = useState<Set<string>>(new Set())
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set())
  const [comments, setComments] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState<Record<string, boolean>>({})
  const [filterStatus, setFilterStatus] = useState<MaintenanceStatus | 'all'>('all')

  // Project → Unit → Items for Maintenance tab
  const grouped = useMemo(() => {
    const filtered = filterStatus === 'all' ? items : items.filter(i => i.status === filterStatus)
    const projectMap = new Map<string, {
      project: { id: string; name: string }
      units: Map<string, { unit: any; items: any[] }>
    }>()

    for (const item of filtered) {
      const p = item.unit?.project
      const u = item.unit
      if (!p || !u) continue
      if (!projectMap.has(p.id)) projectMap.set(p.id, { project: p, units: new Map() })
      const proj = projectMap.get(p.id)!
      if (!proj.units.has(u.id)) proj.units.set(u.id, { unit: u, items: [] })
      proj.units.get(u.id)!.items.push(item)
    }

    return Array.from(projectMap.values()).map(proj => ({
      ...proj,
      units: Array.from(proj.units.values()),
    }))
  }, [items, filterStatus])

  const totalFiltered = grouped.reduce((s, g) => s + g.units.reduce((s2, u) => s2 + u.items.length, 0), 0)

  // Project → Work Orders for Work Orders tab
  const workOrderGroups = useMemo(() => {
    const projectMap = new Map<string, {
      project: { id: string; name: string }
      wos: Map<string, { wo: any; count: number }>
    }>()

    for (const item of items) {
      const p = item.unit?.project
      const wo = item.work_order
      if (!p || !wo) continue
      if (!projectMap.has(p.id)) projectMap.set(p.id, { project: p, wos: new Map() })
      const proj = projectMap.get(p.id)!
      if (!proj.wos.has(wo.id)) proj.wos.set(wo.id, { wo, count: 0 })
      proj.wos.get(wo.id)!.count++
    }

    return Array.from(projectMap.values()).map(proj => ({
      ...proj,
      wos: Array.from(proj.wos.values()),
    }))
  }, [items])

  function toggleUnit(id: string) {
    setExpandedUnits(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleItem(id: string) {
    setExpandedItems(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function updateStatus(itemId: string, status: MaintenanceStatus) {
    setSubmitting(prev => ({ ...prev, [itemId]: true }))
    await fetch(`/api/portal/${token}/update-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemId, status }),
    })
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, status } : i))
    setSubmitting(prev => ({ ...prev, [itemId]: false }))
  }

  async function setScheduledDate(itemId: string, date: string) {
    setSubmitting(prev => ({ ...prev, [`date-${itemId}`]: true }))
    await fetch(`/api/portal/${token}/set-scheduled-date`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemId, scheduled_date: date || null }),
    })
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, scheduled_date: date || null } : i))
    setSubmitting(prev => ({ ...prev, [`date-${itemId}`]: false }))
  }

  async function submitComment(itemId: string) {
    const content = comments[itemId]?.trim()
    if (!content) return
    setSubmitting(prev => ({ ...prev, [`comment-${itemId}`]: true }))
    const res = await fetch(`/api/portal/${token}/add-comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemId, author: contractor.company_name, content }),
    })
    const json = await res.json()
    if (json.data && !json.data.error) {
      setItems(prev => prev.map(i =>
        i.id === itemId ? { ...i, comments: [...(i.comments ?? []), json.data] } : i
      ))
      setComments(prev => ({ ...prev, [itemId]: '' }))
    }
    setSubmitting(prev => ({ ...prev, [`comment-${itemId}`]: false }))
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f7f7f5' }}>
      {/* Header */}
      <div style={{ background: 'white', borderBottom: '1px solid #e9e9e7', padding: '14px 24px' }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#37352f' }}>🏗️ {contractor.company_name}</h1>
        <p style={{ margin: '2px 0 0', fontSize: 13, color: '#787774' }}>Maintenance Portal</p>
      </div>

      {/* Tabs */}
      <div style={{ background: 'white', borderBottom: '1px solid #e9e9e7', padding: '0 24px', display: 'flex' }}>
        {([
          ['maintenance', 'Maintenance', Wrench],
          ['work_orders', 'Work Orders', FileText],
        ] as const).map(([tab, label, Icon]) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '10px 16px', border: 'none', background: 'none', cursor: 'pointer',
              fontSize: 14, fontWeight: activeTab === tab ? 600 : 400,
              color: activeTab === tab ? '#37352f' : '#787774',
              borderBottom: activeTab === tab ? '2px solid #37352f' : '2px solid transparent',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {/* ── MAINTENANCE TAB ── */}
      {activeTab === 'maintenance' && (
        <>
          {/* Filter bar */}
          <div style={{ background: 'white', borderBottom: '1px solid #e9e9e7', padding: '10px 24px', display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
            <select className="input" style={{ width: 'auto' }} value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)}>
              <option value="all">All Status</option>
              {(['assigned', 'in_progress', 'contractor_complete'] as MaintenanceStatus[]).map(s => (
                <option key={s} value={s}>{s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>
              ))}
            </select>
            <span style={{ fontSize: 13, color: '#787774' }}>{totalFiltered} item{totalFiltered !== 1 ? 's' : ''}</span>
          </div>

          <div style={{ padding: '20px 24px', maxWidth: 900, margin: '0 auto' }}>
            {grouped.length === 0 ? (
              <div className="empty-state" style={{ background: 'white', borderRadius: 8 }}>
                <p style={{ fontSize: 15, fontWeight: 500 }}>No items found</p>
                <p>No maintenance items assigned to you at the moment.</p>
              </div>
            ) : (
              grouped.map(({ project, units }) => {
                const projectTotal = units.reduce((s, u) => s + u.items.length, 0)
                return (
                  <div key={project.id} style={{ marginBottom: 32 }}>
                    {/* Project header */}
                    <div style={{ marginBottom: 10, paddingBottom: 8, borderBottom: '2px solid #37352f' }}>
                      <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#37352f' }}>{project.name}</h2>
                      {(project as any).development_company && (
                        <div style={{ fontSize: 13, color: '#787774', marginTop: 2 }}>{(project as any).development_company}</div>
                      )}
                      <span style={{ fontSize: 12, color: '#a0a09e' }}>
                        {projectTotal} open item{projectTotal !== 1 ? 's' : ''}
                      </span>
                    </div>

                    {/* Units */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {units.map(({ unit, items: unitItems }) => {
                        const isUnitOpen = expandedUnits.has(unit.id)
                        const hasOwner = unit.owner_name || unit.owner_phone
                        const hasAddress = !!unit.address

                        return (
                          <div key={unit.id} style={{ border: '1px solid #e9e9e7', borderRadius: 8, overflow: 'hidden', background: 'white' }}>
                            {/* Unit header — click to expand/collapse */}
                            <div
                              onClick={() => toggleUnit(unit.id)}
                              style={{ padding: '14px 16px', cursor: 'pointer', display: 'flex', gap: 12, alignItems: 'flex-start' }}
                            >
                              <div style={{ flex: 1 }}>
                                {/* Unit identifier + item count */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: hasOwner || hasAddress ? 6 : 0 }}>
                                  <span style={{ fontSize: 15, fontWeight: 700, color: '#37352f' }}>{unit.unit_identifier}</span>
                                  <span style={{
                                    fontSize: 11, fontWeight: 500, color: '#787774',
                                    background: '#f0f0ee', borderRadius: 10, padding: '2px 8px',
                                  }}>
                                    {unitItems.length} item{unitItems.length !== 1 ? 's' : ''}
                                  </span>
                                </div>

                                {/* Owner / access details — always visible on the unit row */}
                                {(hasOwner || hasAddress) && (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                    {hasOwner && (
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#37352f' }}>
                                        <User size={12} style={{ color: '#a0a09e', flexShrink: 0 }} />
                                        <span>{unit.owner_name}</span>
                                        {unit.owner_phone && (
                                          <>
                                            <Phone size={12} style={{ color: '#a0a09e', flexShrink: 0, marginLeft: 4 }} />
                                            <span>{unit.owner_phone}</span>
                                          </>
                                        )}
                                      </div>
                                    )}
                                    {hasAddress && (
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#787774' }}>
                                        <MapPin size={12} style={{ color: '#a0a09e', flexShrink: 0 }} />
                                        <span>{unit.address}</span>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>

                              <div style={{ color: '#a0a09e', flexShrink: 0, marginTop: 2 }}>
                                {isUnitOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                              </div>
                            </div>

                            {/* Maintenance items — shown when unit is expanded */}
                            {isUnitOpen && (
                              <div style={{ borderTop: '1px solid #f0f0ee', padding: '12px 12px', display: 'flex', flexDirection: 'column', gap: 8, background: '#fafafa' }}>
                                {unitItems.map((item: any) => (
                                  <ItemRow
                                    key={item.id}
                                    item={item}
                                    isExpanded={expandedItems.has(item.id)}
                                    onToggle={() => toggleItem(item.id)}
                                    comment={comments[item.id] ?? ''}
                                    onComment={val => setComments(prev => ({ ...prev, [item.id]: val }))}
                                    onSubmitComment={() => submitComment(item.id)}
                                    onUpdateStatus={status => updateStatus(item.id, status)}
                                    onSetScheduledDate={date => setScheduledDate(item.id, date)}
                                    isStatusSubmitting={!!submitting[item.id]}
                                    isCommentSubmitting={!!submitting[`comment-${item.id}`]}
                                    isDateSubmitting={!!submitting[`date-${item.id}`]}
                                  />
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </>
      )}

      {/* ── WORK ORDERS TAB ── */}
      {activeTab === 'work_orders' && (
        <div style={{ padding: '20px 24px', maxWidth: 900, margin: '0 auto' }}>
          {workOrderGroups.length === 0 ? (
            <div className="empty-state" style={{ background: 'white', borderRadius: 8 }}>
              <p style={{ fontSize: 15, fontWeight: 500 }}>No work orders</p>
              <p>No work orders have been assigned to you.</p>
            </div>
          ) : (
            workOrderGroups.map(({ project, wos }) => (
              <div key={project.id} style={{ marginBottom: 32 }}>
                <div style={{ marginBottom: 10, paddingBottom: 8, borderBottom: '2px solid #37352f' }}>
                  <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#37352f' }}>{project.name}</h2>
                  {(project as any).development_company && (
                    <div style={{ fontSize: 13, color: '#787774', marginTop: 2 }}>{(project as any).development_company}</div>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {wos.map(({ wo, count }) => {
                    const style = WO_STATUS_STYLE[wo.status] ?? WO_STATUS_STYLE.draft
                    return (
                      <div
                        key={wo.id}
                        style={{
                          background: 'white', border: '1px solid #e9e9e7', borderRadius: 8,
                          padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12,
                        }}
                      >
                        <FileText size={16} style={{ color: '#a0a09e', flexShrink: 0 }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, fontSize: 14, color: '#37352f' }}>{wo.work_order_number}</div>
                          <div style={{ fontSize: 12, color: '#a0a09e', marginTop: 2 }}>
                            {count} item{count !== 1 ? 's' : ''}
                          </div>
                        </div>
                        <span style={{
                          fontSize: 12, fontWeight: 500, padding: '3px 8px', borderRadius: 4,
                          background: style.background, color: style.color,
                        }}>
                          {WO_STATUS_LABEL[wo.status] ?? wo.status}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
