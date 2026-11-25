import { createClient } from '@/lib/supabase/server'
import PageHeader from '@/components/layout/PageHeader'
import Link from 'next/link'
import { WorkOrderStatusBadge } from '@/components/ui/StatusBadge'
import { formatDate, formatUnitLabel } from '@/lib/utils'
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
      .select(`id, reason, estimated_cost, created_at,
        contractor:contractors(id, company_name),
        item:maintenance_items!inner(id, item_number, title, archived_at, unit:units(unit_identifier, address, project:projects(name)))`)
      .eq('status', 'pending')
      .is('item.archived_at', null)
      .order('created_at', { ascending: true }),
  ])

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
        {!!requests?.length && (
          <div style={{ marginBottom: 28 }}>
            <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 600, color: '#37352f', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Receipt size={15} style={{ color: '#c97d0a' }} /> Requested by contractors
              <span style={{ color: '#787774', fontWeight: 400 }}>({requests.length})</span>
            </h3>
            <table className="data-table">
              <thead>
                <tr><th>Item</th><th>Project / Unit</th><th>Contractor</th><th>Reason</th><th>Estimate</th><th>Requested</th></tr>
              </thead>
              <tbody>
                {requests.map(r => {
                  const item = r.item as any
                  return (
                    <tr key={r.id}>
                      <td>
                        <Link href={`/maintenance/${item.id}`} style={{ color: '#2383e2', fontWeight: 500, textDecoration: 'none' }}>{item.item_number}</Link>
                        <div className="wrap-mobile" style={{ fontSize: 13, color: '#37352f' }}>{item.title}</div>
                      </td>
                      <td style={{ fontSize: 13 }}>
                        {item.unit?.project?.name ?? '—'}
                        <div style={{ color: '#787774' }}>{formatUnitLabel(item.unit)}</div>
                      </td>
                      <td>{(r.contractor as any)?.company_name ?? '—'}</td>
                      <td className="wrap-mobile" style={{ fontSize: 13, color: '#37352f', maxWidth: 360, whiteSpace: 'pre-wrap' }}>{r.reason}</td>
                      <td style={{ fontSize: 13 }}>{r.estimated_cost != null ? `$${Number(r.estimated_cost).toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}</td>
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
