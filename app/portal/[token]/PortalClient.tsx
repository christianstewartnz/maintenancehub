'use client'

import { useState, useMemo } from 'react'
import { StatusBadge, PriorityBadge } from '@/components/ui/StatusBadge'
import { formatDate, formatDateTime, STATUS_LABELS } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import type { MaintenanceStatus } from '@/lib/types'
import { ChevronDown, ChevronUp, MessageSquare } from 'lucide-react'

interface Props {
  contractor: { id: string; company_name: string; contact_name: string | null }
  items: any[]
  token: string
}

export default function PortalClient({ contractor, items: initial, token }: Props) {
  const [items, setItems] = useState(initial)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [comments, setComments] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState<Record<string, boolean>>({})
  const [filterStatus, setFilterStatus] = useState<MaintenanceStatus | 'all'>('all')
  const [filterProject, setFilterProject] = useState('')
  const supabase = createClient()

  const projects = useMemo(() => {
    const seen = new Map<string, string>()
    for (const item of items) {
      const p = item.unit?.project
      if (p) seen.set(p.id, p.name)
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }))
  }, [items])

  const filtered = useMemo(() => {
    let result = [...items]
    if (filterStatus !== 'all') result = result.filter(i => i.status === filterStatus)
    if (filterProject) result = result.filter(i => i.unit?.project?.id === filterProject)
    return result
  }, [items, filterStatus, filterProject])

  function toggleExpanded(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function updateStatus(itemId: string, status: MaintenanceStatus) {
    setSubmitting(prev => ({ ...prev, [itemId]: true }))
    await supabase.rpc('portal_update_status', { p_token: token, p_item_id: itemId, p_status: status })
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, status } : i))
    setSubmitting(prev => ({ ...prev, [itemId]: false }))
  }

  async function submitComment(itemId: string) {
    const content = comments[itemId]?.trim()
    if (!content) return
    setSubmitting(prev => ({ ...prev, [`comment-${itemId}`]: true }))
    const { data } = await supabase.rpc('portal_add_comment', {
      p_token: token,
      p_item_id: itemId,
      p_author: contractor.company_name,
      p_content: content,
    })
    if (data && !(data as any).error) {
      setItems(prev => prev.map(i => i.id === itemId ? { ...i, comments: [...(i.comments ?? []), data] } : i))
      setComments(prev => ({ ...prev, [itemId]: '' }))
    }
    setSubmitting(prev => ({ ...prev, [`comment-${itemId}`]: false }))
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f7f7f5' }}>
      {/* Header */}
      <div style={{ background: 'white', borderBottom: '1px solid #e9e9e7', padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#37352f' }}>🏗️ {contractor.company_name}</h1>
          <p style={{ margin: '2px 0 0', fontSize: 13, color: '#787774' }}>Maintenance Portal</p>
        </div>
        <div style={{ fontSize: 13, color: '#787774' }}>{filtered.length} item{filtered.length !== 1 ? 's' : ''}</div>
      </div>

      {/* Filter bar */}
      <div style={{ background: 'white', borderBottom: '1px solid #e9e9e7', padding: '10px 24px', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <select className="input" style={{ width: 'auto' }} value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)}>
          <option value="all">All Status</option>
          {(['assigned','in_progress','contractor_complete','confirmed'] as MaintenanceStatus[]).map(s => (
            <option key={s} value={s}>{s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>
          ))}
        </select>
        {projects.length > 1 && (
          <select className="input" style={{ width: 'auto' }} value={filterProject} onChange={e => setFilterProject(e.target.value)}>
            <option value="">All Projects</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
      </div>

      {/* Items */}
      <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 900, margin: '0 auto' }}>
        {filtered.length === 0 ? (
          <div className="empty-state" style={{ background: 'white', borderRadius: 8 }}>
            <p style={{ fontSize: 15, fontWeight: 500 }}>No items found</p>
            <p>No maintenance items assigned to you at the moment.</p>
          </div>
        ) : (
          filtered.map((item: any) => {
            const unit = item.unit
            const isExpanded = expanded.has(item.id)
            const isSubmitting = !!submitting[item.id]

            return (
              <div key={item.id} style={{ background: 'white', border: '1px solid #e9e9e7', borderRadius: 8, overflow: 'hidden' }}>
                {/* Item header */}
                <div
                  onClick={() => toggleExpanded(item.id)}
                  style={{ padding: '14px 16px', cursor: 'pointer', display: 'flex', gap: 12, alignItems: 'flex-start' }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12, color: '#787774' }}>{item.item_number}</span>
                      <StatusBadge status={item.status} />
                      <PriorityBadge priority={item.priority} />
                      {item.comments?.length > 0 && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 12, color: '#787774' }}>
                          <MessageSquare size={12} /> {item.comments.length}
                        </span>
                      )}
                    </div>
                    <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#37352f' }}>{item.title}</h3>
                    <div style={{ fontSize: 13, color: '#787774', marginTop: 4 }}>
                      {unit?.project?.name} · {unit?.unit_identifier}
                      {unit?.address && ` · ${unit.address}`}
                    </div>
                  </div>
                  <div style={{ color: '#787774', flexShrink: 0 }}>
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div style={{ borderTop: '1px solid #e9e9e7', padding: '16px 16px' }}>
                    {item.description && (
                      <p style={{ margin: '0 0 14px', fontSize: 14, color: '#37352f', whiteSpace: 'pre-wrap' }}>{item.description}</p>
                    )}

                    {/* Access info */}
                    <div style={{ background: '#f7f7f5', borderRadius: 6, padding: '10px 14px', marginBottom: 14, fontSize: 13 }}>
                      <div style={{ fontWeight: 500, marginBottom: 4 }}>Site Access</div>
                      {unit?.owner_name && <div><span style={{ color: '#787774' }}>Owner: </span>{unit.owner_name}{unit.owner_phone ? ` · ${unit.owner_phone}` : ''}</div>}
                      {unit?.address && <div><span style={{ color: '#787774' }}>Address: </span>{unit.address}</div>}
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                      {item.status === 'assigned' && (
                        <button className="btn btn-secondary" disabled={isSubmitting} onClick={() => updateStatus(item.id, 'in_progress')}>
                          Mark as In Progress
                        </button>
                      )}
                      {(item.status === 'assigned' || item.status === 'in_progress') && (
                        <button className="btn btn-primary" disabled={isSubmitting} onClick={() => updateStatus(item.id, 'contractor_complete')}>
                          {isSubmitting ? 'Updating…' : 'Mark Complete'}
                        </button>
                      )}
                    </div>

                    {/* Comments */}
                    <div>
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
                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        <textarea
                          className="input"
                          placeholder="Add a comment…"
                          value={comments[item.id] ?? ''}
                          onChange={e => setComments(prev => ({ ...prev, [item.id]: e.target.value }))}
                          style={{ minHeight: 60 }}
                        />
                      </div>
                      <button
                        className="btn btn-secondary"
                        style={{ marginTop: 8 }}
                        onClick={() => submitComment(item.id)}
                        disabled={!comments[item.id]?.trim() || !!submitting[`comment-${item.id}`]}
                      >
                        {submitting[`comment-${item.id}`] ? 'Posting…' : 'Post Comment'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
