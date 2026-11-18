'use client'

import { useState } from 'react'
import { Mail } from 'lucide-react'
import { COUNTS_CHANGED_EVENT } from '@/lib/contractor-notify'
import { formatUnitLabel } from '@/lib/utils'

export interface PendingNotifyItem {
  id: string
  item_number: string
  title: string
  unit?: { unit_identifier: string | null; address?: string | null; project?: { name: string } | null } | null
}

interface Props {
  contractor: { id: string; company_name: string; email: string | null }
  items: PendingNotifyItem[]
  onClose: () => void
  /** Called after a successful send / mark, with the item ids that were stamped. */
  onDone: (ids: string[], mode: 'email' | 'mark') => void
}

/** Preview + confirm dialog for emailing a contractor about their new items. */
export default function NotifyContractorModal({ contractor, items, onClose, onDone }: Props) {
  const [busy, setBusy] = useState<'email' | 'mark' | null>(null)
  const [error, setError] = useState('')

  async function run(mode: 'email' | 'mark') {
    setBusy(mode)
    setError('')
    const ids = items.map(i => i.id)
    const res = await fetch(`/api/contractors/${contractor.id}/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, item_ids: ids }),
    })
    const json = await res.json().catch(() => ({}))
    setBusy(null)
    if (!res.ok) {
      setError(json.error ?? 'Something went wrong.')
      return
    }
    window.dispatchEvent(new Event(COUNTS_CHANGED_EVENT))
    onDone(ids, mode)
  }

  const n = items.length

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 620 }}>
        <div className="modal-header">
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Notify {contractor.company_name}</h2>
          <button className="btn btn-ghost" style={{ padding: '4px 8px' }} onClick={onClose} disabled={!!busy}>✕</button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ margin: 0, fontSize: 14, color: '#37352f' }}>
            {contractor.email
              ? <>An email listing these <strong>{n} new item{n !== 1 ? 's' : ''}</strong> and their portal link will be sent to <strong>{contractor.email}</strong>, with a copy to you.</>
              : <>This contractor has <strong>no email address</strong>. Add one to email them, or mark these items as told if you&apos;ve let them know another way.</>}
          </p>
          <div style={{ border: '1px solid #e9e9e7', borderRadius: 8, maxHeight: 320, overflowY: 'auto' }}>
            <table className="data-table" style={{ marginBottom: 0 }}>
              <thead><tr><th>#</th><th>Title</th><th>Project</th><th>Unit</th></tr></thead>
              <tbody>
                {items.map(i => (
                  <tr key={i.id}>
                    <td style={{ fontSize: 13, color: '#787774', whiteSpace: 'nowrap' }}>{i.item_number}</td>
                    <td className="wrap-mobile" style={{ fontWeight: 500 }}>{i.title}</td>
                    <td style={{ fontSize: 13, color: '#787774' }}>{i.unit?.project?.name ?? '—'}</td>
                    <td style={{ fontSize: 13 }}>{formatUnitLabel(i.unit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {error && <p style={{ color: '#e03131', fontSize: 14, margin: 0 }}>{error}</p>}
        </div>
        <div className="modal-footer" style={{ alignItems: 'center' }}>
          <button
            className="btn btn-ghost"
            style={{ fontSize: 13, color: '#787774', marginRight: 'auto' }}
            onClick={() => run('mark')}
            disabled={!!busy}
            title="Clear these from the to-notify list without sending an email"
          >
            {busy === 'mark' ? 'Marking…' : 'Mark as told (no email)'}
          </button>
          <button className="btn btn-secondary" onClick={onClose} disabled={!!busy}>Cancel</button>
          <button className="btn btn-primary" onClick={() => run('email')} disabled={!!busy || !contractor.email}>
            <Mail size={14} /> {busy === 'email' ? 'Sending…' : `Send email (${n})`}
          </button>
        </div>
      </div>
    </div>
  )
}
