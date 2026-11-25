'use client'

import { useEffect, useState } from 'react'
import { Mail } from 'lucide-react'
import { COUNTS_CHANGED_EVENT } from '@/lib/contractor-notify'
import { formatUnitLabel } from '@/lib/utils'

export interface PendingNotifyItem {
  id: string
  item_number: string
  title: string
  unit?: { unit_identifier: string | null; address?: string | null; project?: { name: string } | null } | null
  /** Set on other staff members' items (admin "include others"): whose item it is. */
  responsible_name?: string
}

/** GET /api/contractors/[id]/notify: other staff's pending items for this contractor. */
interface OthersSummary {
  count: number
  /** Admin only. */
  people?: { name: string; count: number }[]
  /** Admin only. */
  items?: PendingNotifyItem[]
}

interface Props {
  contractor: { id: string; company_name: string; email: string | null }
  /** The signed-in user's own pending items (the API only sends those, unless an admin includes others). */
  items: PendingNotifyItem[]
  onClose: () => void
  /** Called after a successful send / mark, with the item ids that were stamped. */
  onDone: (ids: string[], mode: NotifyMode) => void
}

export type NotifyMode = 'email' | 'outlook' | 'mark'

/**
 * Preview + confirm dialog for emailing a contractor about their new items.
 *
 * Each person notifies about their own items. The dialog also says how many of the
 * contractor's pending items belong to other staff (left out); admins can tick
 * "include" to send those too, on the other person's behalf.
 */
export default function NotifyContractorModal({ contractor, items: myItems, onClose, onDone }: Props) {
  const [busy, setBusy] = useState<NotifyMode | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [others, setOthers] = useState<OthersSummary | null>(null)
  const [includeOthers, setIncludeOthers] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/contractors/${contractor.id}/notify`)
      .then(res => (res.ok ? res.json() : null))
      .then(json => { if (!cancelled && json?.others) setOthers(json.others) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [contractor.id])

  const otherItems = others?.items ?? []
  const items = includeOthers ? [...myItems, ...otherItems] : myItems

  async function run(mode: NotifyMode) {
    setBusy(mode)
    setError('')
    const ids = items.map(i => i.id)
    const res = await fetch(`/api/contractors/${contractor.id}/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode,
        item_ids: ids,
        message: mode !== 'mark' ? message.trim() || undefined : undefined,
        include_others: includeOthers || undefined,
      }),
    })

    if (mode === 'outlook' && res.ok) {
      // The response is the .eml draft: download it so Outlook opens it, ready to send.
      const blob = await res.blob()
      const stamped = res.headers.get('X-Item-Ids')?.split(',').filter(Boolean) ?? ids
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Notify ${contractor.company_name.trim().replace(/[\\/:*?"<>|]+/g, '-')}.eml`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      setBusy(null)
      window.dispatchEvent(new Event(COUNTS_CHANGED_EVENT))
      onDone(stamped, mode)
      return
    }

    const json = await res.json().catch(() => ({}))
    setBusy(null)
    if (!res.ok) {
      setError(json.error ?? 'Something went wrong.')
      return
    }
    window.dispatchEvent(new Event(COUNTS_CHANGED_EVENT))
    // The server leaves out items that aren't the sender's; report what it actually stamped.
    onDone(Array.isArray(json.item_ids) ? json.item_ids : ids, mode)
  }

  const n = items.length
  const othersCount = others?.count ?? 0

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 720 }}>
        <div className="modal-header">
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Notify {contractor.company_name}</h2>
          <button className="btn btn-ghost" style={{ padding: '4px 8px' }} onClick={onClose} disabled={!!busy}>✕</button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ margin: 0, fontSize: 14, color: '#37352f' }}>
            {n === 0
              ? <>You have no new items to send this contractor.</>
              : contractor.email
                ? <>An email listing these <strong>{n} new item{n !== 1 ? 's' : ''}</strong> and their portal link will be sent to <strong>{contractor.email}</strong>, with a copy to you. You&apos;ll be shown as their contact.</>
                : <>This contractor has <strong>no email address</strong>. Add one to email them, or mark these items as told if you&apos;ve let them know another way.</>}
          </p>
          {n > 0 && (
            <div style={{ border: '1px solid #e9e9e7', borderRadius: 8, maxHeight: 320, overflowY: 'auto' }}>
              <table className="data-table" style={{ marginBottom: 0 }}>
                <thead><tr><th>#</th><th>Title</th><th>Project</th><th>Unit</th></tr></thead>
                <tbody>
                  {items.map(i => (
                    <tr key={i.id}>
                      <td style={{ fontSize: 13, color: '#787774', whiteSpace: 'nowrap' }}>{i.item_number}</td>
                      <td className="wrap-mobile" style={{ fontWeight: 500 }}>
                        {i.title}
                        {i.responsible_name && (
                          <span title="Another staff member's item, sent on their behalf" style={{ marginLeft: 8, background: '#f1f1ef', color: '#787774', borderRadius: 10, padding: '1px 7px', fontWeight: 500, fontSize: 11, whiteSpace: 'nowrap' }}>
                            {i.responsible_name}
                          </span>
                        )}
                      </td>
                      <td style={{ fontSize: 13, color: '#787774' }}>{i.unit?.project?.name ?? '—'}</td>
                      <td style={{ fontSize: 13 }}>{formatUnitLabel(i.unit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {othersCount > 0 && (
            <div style={{ fontSize: 13, color: '#787774', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {!includeOthers && (
                <span>
                  {others?.people?.length
                    ? <>Not included (other staff&apos;s items): {others.people.map(p => `${p.name} (${p.count})`).join(', ')}.</>
                    : <>{othersCount} more item{othersCount !== 1 ? 's' : ''} for this contractor {othersCount !== 1 ? 'belong' : 'belongs'} to other staff and {othersCount !== 1 ? 'are' : 'is'} not included.</>}
                </span>
              )}
              {otherItems.length > 0 && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#37352f', cursor: 'pointer' }}>
                  <input type="checkbox" checked={includeOthers} onChange={e => setIncludeOthers(e.target.checked)} disabled={!!busy} />
                  Include other staff&apos;s items ({otherItems.length}) and send on their behalf
                </label>
              )}
            </div>
          )}
          {contractor.email && n > 0 && (
            <div>
              <label htmlFor="notify-message" style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 5 }}>
                Note to contractor <span style={{ color: '#787774', fontWeight: 400 }}>(optional)</span>
              </label>
              <textarea
                id="notify-message"
                className="input"
                rows={4}
                value={message}
                onChange={e => setMessage(e.target.value)}
                disabled={!!busy}
                maxLength={4000}
                placeholder="e.g. Please prioritise the leak at Unit 3 — owner is away from Friday."
                style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit', fontSize: 14 }}
              />
              <p style={{ margin: '4px 0 0', fontSize: 12, color: '#787774' }}>Added near the top of the email, under the greeting. &ldquo;Generate Outlook email&rdquo; downloads the same email as a draft to send from your Outlook.</p>
            </div>
          )}
          {error &&<p style={{ color: '#e03131', fontSize: 14, margin: 0 }}>{error}</p>}
        </div>
        <div className="modal-footer" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 8, rowGap: 8 }}>
          <button
            className="btn btn-ghost"
            style={{ fontSize: 13, color: '#787774', marginRight: 'auto', paddingLeft: 0, whiteSpace: 'nowrap' }}
            onClick={() => run('mark')}
            disabled={!!busy || n === 0}
            title="Clear these from the to-notify list without sending an email"
          >
            {busy === 'mark' ? 'Marking…' : 'Mark as told (no email)'}
          </button>
          <button className="btn btn-secondary" onClick={onClose} disabled={!!busy}>Cancel</button>
          <button
            className="btn btn-secondary"
            style={{ whiteSpace: 'nowrap' }}
            onClick={() => run('outlook')}
            disabled={!!busy || !contractor.email || n === 0}
            title="Download this email as an Outlook draft to send from your own Outlook. The items are marked as notified."
          >
            <Mail size={14} /> {busy === 'outlook' ? 'Generating…' : 'Generate Outlook email'}
          </button>
          <button className="btn btn-primary" style={{ whiteSpace: 'nowrap' }} onClick={() => run('email')} disabled={!!busy || !contractor.email || n === 0}>
            <Mail size={14} /> {busy === 'email' ? 'Sending…' : `Send email (${n})`}
          </button>
        </div>
      </div>
    </div>
  )
}
