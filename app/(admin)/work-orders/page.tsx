import { createClient } from '@/lib/supabase/server'
import PageHeader from '@/components/layout/PageHeader'
import Link from 'next/link'
import { WorkOrderStatusBadge } from '@/components/ui/StatusBadge'
import { formatDate, formatHours, formatUnitLabel } from '@/lib/utils'
import { Plus, Receipt } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function WorkOrdersPage() {
  const supabase = await createClient()
  const [{ data: workOrders }, { data: requests }] = await Promise.all([
    supabase
      .from('work_orders')
      .select('*, project:projects(id, name), contractor:contractors(id, company_name)')
      .order('created_at', { ascending: false }),
    // Contractors asking for a work order from the portal, waiting for an answer (RLS: projects I can see)
    supabase
      .from('work_order_requests')
      .select(`id, group_id, reason, estimated_cost, estimated_hours, created_at,
        contractor:contractors(id, company_name),
        item:maintenance_items!inner(id, item_number, title, archived_at, unit:units(unit_identifier, address, project:projects(name)))`)
      .eq('status', 'pending')
      .is('item.archived_at', null)
      .order('created_at', { ascending: true }),
  ])

  // Items requested together (one work order for several items of a unit) show as one row.
  const requestRows: { key: string; first: any; items: any[] }[] = []
  const byGroup = new Map<string, { key: string; first: any; items: any[] }>()
  for (const r of requests ?? []) {
    const existing = r.group_id ? byGroup.get(r.group_id) : undefined
    if (existing) { existing.items.push(r.item); continue }
    const row = { key: r.group_id ?? r.id, first: r, items: [r.item] }
    requestRows.push(row)
    if (r.group_id) byGroup.set(r.group_id, row)
  }
  for (const row of requestRows) {
    row.items.sort((a: any, b: any) => a.item_number.localeCompare(b.item_number, undefined, { numeric: true }))
  }

  return (
    <div>
      <PageHeader
        title="Work Orders"
        description="Formal work orders sent to contractors"
        actions={
          <Link href="/work-orders/new" className="btn btn-primary"><Plus size={16} /> New Work Order</Link>
        }
      />
      <div className="page-content" style={{ padding: '24px 32px' }}>
        {requestRows.length > 0 && (
          <div style={{ marginBottom: 28 }}>
            <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 600, color: '#37352f', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Receipt size={15} style={{ color: '#c97d0a' }} /> Requested by contractors
              <span style={{ color: '#787774', fontWeight: 400 }}>({requestRows.length})</span>
            </h3>
            <table className="data-table">
              <thead>
                <tr><th>Items</th><th>Project / Unit</th><th>Contractor</th><th>Reason</th><th>Estimate</th><th>Requested</th></tr>
              </thead>
              <tbody>
                {requestRows.map(({ key, first: r, items }) => {
                  const item = items[0] as any
                  return (
                    <tr key={key}>
                      <td>
                        {items.map((it: any) => (
                          <div key={it.id} style={{ marginBottom: items.length > 1 ? 4 : 0 }}>
                            <Link href={`/maintenance/${it.id}`} style={{ color: '#2383e2', fontWeight: 500, textDecoration: 'none' }}>{it.item_number}</Link>
                            <div className="wrap-mobile" style={{ fontSize: 13, color: '#37352f' }}>{it.title}</div>
                          </div>
                        ))}
                      </td>
                      <td style={{ fontSize: 13 }}>
                        {item.unit?.project?.name ?? '—'}
                        <div style={{ color: '#787774' }}>{formatUnitLabel(item.unit)}</div>
                      </td>
                      <td>{(r.contractor as any)?.company_name ?? '—'}</td>
                      <td className="wrap-mobile" style={{ fontSize: 13, color: '#37352f', maxWidth: 360, whiteSpace: 'pre-wrap' }}>{r.reason}</td>
                      <td style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
                        {r.estimated_cost == null && r.estimated_hours == null && '—'}
                        {r.estimated_hours != null && <div>{formatHours(r.estimated_hours)}</div>}
                        {r.estimated_cost != null && <div>${Number(r.estimated_cost).toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>}
                      </td>
                      <td style={{ fontSize: 13, color: '#787774' }}>{formatDate(r.created_at)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {!workOrders?.length ? (
          <div className="empty-state">
            <p style={{ fontSize: 15, fontWeight: 500 }}>No work orders yet</p>
            <p>Create a work order to group and send maintenance items to a contractor.</p>
            <Link href="/work-orders/new" className="btn btn-primary" style={{ marginTop: 16 }}><Plus size={16} /> Create Work Order</Link>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr><th>#</th><th>Project</th><th>Contractor</th><th>Status</th><th>Created</th><th>Sent</th></tr>
            </thead>
            <tbody>
              {workOrders.map(wo => (
                <tr key={wo.id}>
                  <td><Link href={`/work-orders/${wo.id}`} style={{ color: '#2383e2', fontWeight: 500, textDecoration: 'none' }}>{wo.work_order_number}</Link></td>
                  <td>{(wo.project as any)?.name ?? '—'}</td>
                  <td>{(wo.contractor as any)?.company_name ?? '—'}</td>
                  <td><WorkOrderStatusBadge status={wo.status} /></td>
                  <td style={{ fontSize: 13, color: '#787774' }}>{formatDate(wo.created_at)}</td>
                  <td style={{ fontSize: 13, color: '#787774' }}>{wo.sent_at ? formatDate(wo.sent_at) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
