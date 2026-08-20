'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Copy, Check, ExternalLink } from 'lucide-react'
import { StatusBadge, PriorityBadge } from '@/components/ui/StatusBadge'
import { formatDate } from '@/lib/utils'
import type { Contractor } from '@/lib/types'

interface Props {
  contractor: Contractor
  assignments: any[]
  items: any[]
}

export default function ContractorDetailClient({ contractor, assignments, items }: Props) {
  const [copied, setCopied] = useState(false)
  const portalUrl = typeof window !== 'undefined' ? `${window.location.origin}/portal/${contractor.portal_token}` : `/portal/${contractor.portal_token}`

  function copyLink() {
    navigator.clipboard.writeText(portalUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const openItems = items.filter(i => i.status !== 'complete')
  const completedItems = items.filter(i => i.status === 'complete')

  return (
    <div style={{ padding: '24px 32px', display: 'grid', gridTemplateColumns: '1fr 280px', gap: 28, alignItems: 'start' }}>
      <div>
        {/* Open items */}
        <h3 style={{ fontSize: 14, fontWeight: 600, color: '#37352f', marginBottom: 12 }}>
          Open Items ({openItems.length})
        </h3>
        {openItems.length === 0 ? (
          <p style={{ color: '#787774', fontSize: 14 }}>No open items.</p>
        ) : (
          <table className="data-table" style={{ marginBottom: 28 }}>
            <thead><tr><th>#</th><th>Title</th><th>Project</th><th>Unit</th><th>Status</th><th>Priority</th><th>Age</th></tr></thead>
            <tbody>
              {openItems.map((item: any) => (
                <tr key={item.id}>
                  <td style={{ color: '#787774', fontSize: 13 }}>{item.item_number}</td>
                  <td><Link href={`/maintenance/${item.id}`} style={{ color: '#37352f', fontWeight: 500, textDecoration: 'none' }}>{item.title}</Link></td>
                  <td style={{ fontSize: 13, color: '#787774' }}>{item.unit?.project?.name ?? '—'}</td>
                  <td style={{ fontSize: 13 }}>{item.unit?.unit_identifier ?? '—'}</td>
                  <td><StatusBadge status={item.status} /></td>
                  <td><PriorityBadge priority={item.priority} /></td>
                  <td style={{ fontSize: 13, color: '#787774' }}>{formatDate(item.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {completedItems.length > 0 && (
          <>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: '#787774', marginBottom: 12 }}>Completed ({completedItems.length})</h3>
            <table className="data-table">
              <thead><tr><th>#</th><th>Title</th><th>Project</th><th>Unit</th><th>Completed</th></tr></thead>
              <tbody>
                {completedItems.slice(0, 20).map((item: any) => (
                  <tr key={item.id}>
                    <td style={{ color: '#787774', fontSize: 13 }}>{item.item_number}</td>
                    <td><Link href={`/maintenance/${item.id}`} style={{ color: '#37352f', fontWeight: 500, textDecoration: 'none' }}>{item.title}</Link></td>
                    <td style={{ fontSize: 13, color: '#787774' }}>{item.unit?.project?.name ?? '—'}</td>
                    <td style={{ fontSize: 13 }}>{item.unit?.unit_identifier ?? '—'}</td>
                    <td style={{ fontSize: 13, color: '#787774' }}>{formatDate(item.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      {/* Sidebar */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ border: '1px solid #e9e9e7', borderRadius: 8, padding: '14px 16px' }}>
          <h4 style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 600, color: '#787774', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Contact</h4>
          {contractor.contact_name && <Row label="Name" value={contractor.contact_name} />}
          {contractor.email && <Row label="Email" value={contractor.email} />}
          {contractor.phone && <Row label="Phone" value={contractor.phone} />}
          {contractor.notes && <><div style={{ borderTop: '1px solid #f1f1ef', margin: '8px 0' }} /><p style={{ fontSize: 13, color: '#37352f' }}>{contractor.notes}</p></>}
        </div>

        <div style={{ border: '1px solid #e9e9e7', borderRadius: 8, padding: '14px 16px' }}>
          <h4 style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 600, color: '#787774', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Contractor Portal</h4>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-secondary" style={{ flex: 1, justifyContent: 'center', fontSize: 13 }} onClick={copyLink}>
              {copied ? <><Check size={13} /> Copied!</> : <><Copy size={13} /> Copy Link</>}
            </button>
            <a href={`/portal/${contractor.portal_token}`} target="_blank" rel="noopener noreferrer" className="btn btn-secondary" style={{ padding: '6px 10px' }}>
              <ExternalLink size={14} />
            </a>
          </div>
        </div>

        {assignments.length > 0 && (
          <div style={{ border: '1px solid #e9e9e7', borderRadius: 8, padding: '14px 16px' }}>
            <h4 style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 600, color: '#787774', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Project Assignments</h4>
            {assignments.map((a: any) => (
              <div key={a.id} style={{ fontSize: 13, marginBottom: 6 }}>
                <Link href={`/projects/${a.project?.id}`} style={{ color: '#2383e2', textDecoration: 'none' }}>{a.project?.name}</Link>
                <span style={{ color: '#787774' }}> · {a.trade?.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, fontSize: 13, marginBottom: 4 }}>
      <span style={{ color: '#787774', minWidth: 48, flexShrink: 0 }}>{label}</span>
      <span style={{ color: '#37352f' }}>{value}</span>
    </div>
  )
}
