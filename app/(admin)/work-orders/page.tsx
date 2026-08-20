import { createClient } from '@/lib/supabase/server'
import PageHeader from '@/components/layout/PageHeader'
import Link from 'next/link'
import { WorkOrderStatusBadge } from '@/components/ui/StatusBadge'
import { formatDate } from '@/lib/utils'
import { Plus } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function WorkOrdersPage() {
  const supabase = await createClient()
  const { data: workOrders } = await supabase
    .from('work_orders')
    .select('*, project:projects(id, name), contractor:contractors(id, company_name)')
    .order('created_at', { ascending: false })

  return (
    <div>
      <PageHeader
        emoji="📋"
        title="Work Orders"
        description="Formal work orders sent to contractors"
        actions={
          <Link href="/work-orders/new" className="btn btn-primary"><Plus size={16} /> New Work Order</Link>
        }
      />
      <div style={{ padding: '24px 32px' }}>
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
