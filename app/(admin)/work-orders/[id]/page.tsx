import { createClient } from '@/lib/supabase/server'
import PageHeader from '@/components/layout/PageHeader'
import WorkOrderDetailClient from './WorkOrderDetailClient'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function WorkOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: workOrder }, { data: items }] = await Promise.all([
    supabase
      .from('work_orders')
      .select('*, project:projects(id, name, address), contractor:contractors(id, company_name, contact_name, email, phone, portal_token)')
      .eq('id', id)
      .single(),
    supabase
      .from('maintenance_items')
      .select('*, unit:units(id, unit_identifier, lot_number, address, access_contact_name, access_contact_phone, owners:unit_owners(id, name, email, phone)), trade:trades(name)')
      .eq('work_order_id', id)
      .order('created_at'),
  ])

  if (!workOrder) notFound()

  // Items that could be added while it's a draft: this contractor's open, unassigned
  // items in the project — on the same unit as the current items (one unit per work order).
  let available: any[] = []
  if (workOrder.status === 'draft' && !workOrder.archived_at) {
    const unitId = items?.[0]?.unit_id as string | undefined
    let q = supabase
      .from('maintenance_items')
      .select('id, item_number, title, status, unit_id, unit:units!inner(id, unit_identifier, address, project_id)')
      .eq('contractor_id', workOrder.contractor_id)
      .eq('unit.project_id', workOrder.project_id)
      .is('work_order_id', null)
      .is('archived_at', null)
      .neq('status', 'complete')
      .order('created_at')
    if (unitId) q = q.eq('unit_id', unitId)
    available = (await q).data ?? []
  }

  return (
    <div>
      <PageHeader
        backHref="/work-orders"
        title={workOrder.work_order_number}
        description={`${(workOrder.project as any)?.name} — ${(workOrder.contractor as any)?.company_name}`}
      />
      <WorkOrderDetailClient workOrder={workOrder as any} items={items ?? []} available={available} />
    </div>
  )
}
