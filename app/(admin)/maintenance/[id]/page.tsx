import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import PageHeader from '@/components/layout/PageHeader'
import ItemDetailClient from './ItemDetailClient'

export const dynamic = 'force-dynamic'

export default async function MaintenanceItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [itemRes, activityRes, commentsRes, attachmentsRes, contractorsRes] = await Promise.all([
    supabase.from('maintenance_items').select(`
      id, item_number, title, description, status, priority, created_at, updated_at, completed_at,
      contractor_id, trade_id, unit_id,
      unit:units(id, unit_identifier, lot_number, address, owner_name, owner_email, owner_phone, access_contact_name, access_contact_phone, settlement_date, project:projects(id, name)),
      trade:trades(id, name),
      contractor:contractors(id, company_name, contact_name, email, phone),
      work_order:work_orders(id, work_order_number)
    `).eq('id', id).single(),
    supabase.from('activity_log').select('*').eq('maintenance_item_id', id).order('created_at', { ascending: false }),
    supabase.from('contractor_comments').select('*').eq('maintenance_item_id', id).order('created_at'),
    supabase.from('maintenance_item_attachments').select('*').eq('maintenance_item_id', id).order('created_at'),
    supabase.from('contractors').select('id, company_name').order('company_name'),
  ])

  if (!itemRes.data) notFound()

  const projectId = (itemRes.data as any).unit?.project?.id
  const tradesRes = projectId
    ? await supabase.from('trades').select('*').eq('project_id', projectId).order('name')
    : { data: [] }

  return (
    <div>
      <PageHeader
        title={itemRes.data.item_number}
        description={itemRes.data.title}
        breadcrumbs={[
          { label: 'Maintenance', href: '/maintenance' },
          { label: itemRes.data.item_number },
        ]}
      />
      <ItemDetailClient
        item={itemRes.data as any}
        activity={activityRes.data ?? []}
        comments={commentsRes.data ?? []}
        attachments={attachmentsRes.data ?? []}
        contractors={contractorsRes.data ?? []}
        trades={tradesRes.data ?? []}
      />
    </div>
  )
}
