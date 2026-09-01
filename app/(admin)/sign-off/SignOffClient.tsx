'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { PriorityBadge } from '@/components/ui/StatusBadge'
import { getDaysSince, formatDateTime } from '@/lib/utils'
import { CheckCheck, RotateCcw, MessageSquare, Clock } from 'lucide-react'

interface Item {
  id: string
  item_number: string
  title: string
  priority: string
  created_at: string
  updated_at: string
  contractor_id: string | null
  unit: any
  contractor: any
  lastComment: { author: string; content: string; created_at: string } | null
}

interface Props {
  items: Item[]
}

export default function SignOffClient({ items: initial }: Props) {
  const [items, setItems] = useState(initial)
  const [confirming, setConfirming] = useState<Set<string>>(new Set())
  const [sendingBack, setSendingBack] = useState<Set<string>>(new Set())
  const [sendBackNotes, setSendBackNotes] = useState<Record<string, string>>({})
  const [showSendBack, setShowSendBack] = useState<Set<string>>(new Set())
  const [bulkConfirming, setBulkConfirming] = useState(false)
  const [isLive, setIsLive] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    const channel = supabase
      .channel('signoff_realtime')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'maintenance_items',
        filter: 'status=eq.contractor_complete',
      }, () => {
        router.refresh()
      })
      .subscribe(status => setIsLive(status === 'SUBSCRIBED'))

    return () => { supabase.removeChannel(channel) }
  }, [])

  // Group items by project → unit
  const groups = useMemo(() => {
    const projectMap = new Map<string, { name: string; units: Map<string, { identifier: string; address: string; items: Item[] }> }>()
    for (const item of items) {
      const unit = item.unit as any
      const projectId = unit?.project?.id ?? '__unknown__'
      const projectName = unit?.project?.name ?? 'Unknown Project'
      const unitId = unit?.id ?? '__unknown__'
      if (!projectMap.has(projectId)) projectMap.set(projectId, { name: projectName, units: new Map() })
      const proj = projectMap.get(projectId)!
      if (!proj.units.has(unitId)) proj.units.set(unitId, { identifier: unit?.unit_identifier ?? 'Unknown Unit', address: unit?.address ?? '', items: [] })
      proj.units.get(unitId)!.items.push(item)
    }
    return Array.from(projectMap.values()).map(proj => ({
      projectName: proj.name,
      units: Array.from(proj.units.values()),
    }))
  }, [items])

  async function confirm(itemId: string) {
    setConfirming(prev => new Set(prev).add(itemId))
    await supabase
      .from('maintenance_items')
      .update({ status: 'confirmed' })
      .eq('id', itemId)
    await supabase.from('activity_log').insert({
      maintenance_item_id: itemId,
      action: 'status_changed',
      details: { from: 'contractor_complete', to: 'confirmed' },
      performed_by: 'admin',
    })
    setItems(prev => prev.filter(i => i.id !== itemId))
    setConfirming(prev => { const s = new Set(prev); s.delete(itemId); return s })
  }

  async function sendBack(itemId: string) {
    const note = sendBackNotes[itemId]?.trim()
    setSendingBack(prev => new Set(prev).add(itemId))
    await supabase
      .from('maintenance_items')
      .update({ status: 'in_progress' })
      .eq('id', itemId)
    await supabase.from('activity_log').insert({
      maintenance_item_id: itemId,
      action: 'status_changed',
      details: { from: 'contractor_complete', to: 'in_progress', note: note || undefined },
      performed_by: 'admin',
    })
    if (note) {
      await supabase.from('contractor_comments').insert({
        maintenance_item_id: itemId,
        author: 'admin',
        content: note,
      })
    }
    setItems(prev => prev.filter(i => i.id !== itemId))
    setSendingBack(prev => { const s = new Set(prev); s.delete(itemId); return s })
  }

  async function confirmAll() {
    if (!items.length) return
    setBulkConfirming(true)
    const ids = items.map(i => i.id)
    await supabase
      .from('maintenance_items')
      .update({ status: 'confirmed' })
      .in('id', ids)
    const logs = ids.map(id => ({
      maintenance_item_id: id,
      action: 'status_changed',
      details: { from: 'contractor_complete', to: 'confirmed' },
      performed_by: 'admin',
    }))
    await supabase.from('activity_log').insert(logs)
    setItems([])
    setBulkConfirming(false)
  }

  function toggleSendBack(id: string) {
    setShowSendBack(prev => {
      const s = new Set(prev)
      s.has(id) ? s.delete(id) : s.add(id)
      return s
    })
  }

  return (
    <div className="page-content" style={{ padding: '24px 32px' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className={`live-dot ${isLive ? 'live-dot--active' : ''}`} />
          <span style={{ fontSize: 12, color: '#787774' }}>{isLive ? 'Live' : 'Connecting…'}</span>
          {items.length > 0 && (
            <span style={{ fontSize: 12, color: '#787774' }}>
              · {items.length} item{items.length !== 1 ? 's' : ''} awaiting
            </span>
          )}
        </div>
        {items.length > 0 && (
          <button
            className="btn btn-primary"
            onClick={confirmAll}
            disabled={bulkConfirming}
          >
            <CheckCheck size={15} />
            {bulkConfirming ? 'Confirming…' : `Confirm All ${items.length}`}
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="empty-state">
          <p style={{ fontSize: 15, fontWeight: 500 }}>Queue is clear</p>
          <p>No items awaiting sign-off right now.</p>
          <Link href="/dashboard" className="btn btn-secondary" style={{ marginTop: 16 }}>
            Back to Dashboard
          </Link>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {groups.map(group => (
            <div key={group.projectName}>
              {/* Project header */}
              <div style={{
                fontSize: 13, fontWeight: 600, color: '#37352f',
                textTransform: 'uppercase', letterSpacing: '0.06em',
                paddingBottom: 8, marginBottom: 12,
                borderBottom: '2px solid #e9e9e7',
              }}>
                {group.projectName}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {group.units.map(unit => (
                  <div key={unit.identifier}>
                    {/* Unit header */}
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      fontSize: 12, fontWeight: 600, color: '#787774',
                      marginBottom: 8, paddingLeft: 4,
                    }}>
                      <span style={{
                        background: '#f0f0ee', borderRadius: 4,
                        padding: '2px 8px', fontSize: 12, fontWeight: 600, color: '#555',
                      }}>
                        {unit.identifier}
                      </span>
                      {unit.address && (
                        <span style={{ fontWeight: 400, color: '#a0a09e' }}>{unit.address}</span>
                      )}
                      <span style={{ color: '#d0d0ce', fontWeight: 400 }}>
                        {unit.items.length} item{unit.items.length !== 1 ? 's' : ''}
                      </span>
                    </div>

                    {/* Items */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 4 }}>
                      {unit.items.map(item => {
                        const contractor = item.contractor as any
                        const days = getDaysSince(item.updated_at)
                        const isConfirming = confirming.has(item.id)
                        const isSendingBack = sendingBack.has(item.id)
                        const showNote = showSendBack.has(item.id)

                        return (
                          <div
                            key={item.id}
                            style={{ background: 'white', border: '1px solid #e9e9e7', borderRadius: 8, overflow: 'hidden' }}
                          >
                            {/* Main row */}
                            <div style={{ padding: '14px 16px', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
                                  <span style={{ fontSize: 12, color: '#a0a09e' }}>{item.item_number}</span>
                                  <PriorityBadge priority={item.priority as any} />
                                  <span style={{
                                    display: 'flex', alignItems: 'center', gap: 4,
                                    fontSize: 12, color: days >= 7 ? '#e03c3c' : '#9a6700',
                                    fontWeight: 500,
                                  }}>
                                    <Clock size={11} />
                                    {days === 0 ? 'Today' : `${days}d waiting`}
                                  </span>
                                </div>
                                <Link
                                  href={`/maintenance/${item.id}`}
                                  style={{ fontSize: 15, fontWeight: 600, color: '#37352f', textDecoration: 'none' }}
                                >
                                  {item.title}
                                </Link>
                                {contractor && (
                                  <div style={{ fontSize: 13, color: '#787774', marginTop: 3 }}>
                                    {contractor.company_name}
                                    {contractor.contact_name && ` — ${contractor.contact_name}`}
                                  </div>
                                )}
                                {item.lastComment && (
                                  <div style={{
                                    marginTop: 10, background: '#f7f7f5', borderRadius: 6,
                                    padding: '8px 12px', fontSize: 13,
                                  }}>
                                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 3 }}>
                                      <MessageSquare size={11} style={{ color: '#a0a09e' }} />
                                      <span style={{ fontWeight: 500, fontSize: 12 }}>{item.lastComment.author}</span>
                                      <span style={{ color: '#a0a09e', fontSize: 11 }}>{formatDateTime(item.lastComment.created_at)}</span>
                                    </div>
                                    <p style={{ margin: 0, color: '#37352f' }}>{item.lastComment.content}</p>
                                  </div>
                                )}
                              </div>

                              {/* Actions */}
                              <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'flex-start' }}>
                                <button
                                  className="btn btn-ghost"
                                  style={{ color: '#787774', fontSize: 13 }}
                                  onClick={() => toggleSendBack(item.id)}
                                  disabled={isSendingBack}
                                  title="Send back to contractor"
                                >
                                  <RotateCcw size={14} />
                                  Send Back
                                </button>
                                <button
                                  className="btn btn-primary"
                                  onClick={() => confirm(item.id)}
                                  disabled={isConfirming || isSendingBack}
                                >
                                  <CheckCheck size={15} />
                                  {isConfirming ? 'Confirming…' : 'Confirm'}
                                </button>
                              </div>
                            </div>

                            {/* Send-back note panel */}
                            {showNote && (
                              <div style={{ borderTop: '1px solid #f0f0ee', padding: '12px 16px', background: '#fafafa' }}>
                                <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8, color: '#37352f' }}>
                                  Note for contractor (optional)
                                </div>
                                <textarea
                                  className="input"
                                  placeholder="Describe what needs to be fixed or re-done…"
                                  value={sendBackNotes[item.id] ?? ''}
                                  onChange={e => setSendBackNotes(prev => ({ ...prev, [item.id]: e.target.value }))}
                                  style={{ minHeight: 64, marginBottom: 8 }}
                                />
                                <div style={{ display: 'flex', gap: 8 }}>
                                  <button
                                    className="btn btn-danger"
                                    onClick={() => sendBack(item.id)}
                                    disabled={isSendingBack}
                                  >
                                    <RotateCcw size={14} />
                                    {isSendingBack ? 'Sending…' : 'Send Back'}
                                  </button>
                                  <button
                                    className="btn btn-ghost"
                                    onClick={() => toggleSendBack(item.id)}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
