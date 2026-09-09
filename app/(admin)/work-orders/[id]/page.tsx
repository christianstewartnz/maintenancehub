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

  return (
    <div>
      <PageHeader
        emoji="📋"
        title={workOrder.work_order_number}
        description={`${(workOrder.project as any)?.name} — ${(workOrder.contractor as any)?.company_name}`}
      />
      <WorkOrderDetailClient workOrder={workOrder as any} items={items ?? []} />
    </div>
  )
}
