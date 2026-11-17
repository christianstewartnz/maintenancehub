import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import PageHeader from '@/components/layout/PageHeader'
import ItemDetailClient from './ItemDetailClient'
import { withSignedUrls } from '@/lib/photos'

export const dynamic = 'force-dynamic'

export default async function MaintenanceItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [itemRes, activityRes, commentsRes, attachmentsRes, contractorsRes, updatesRes, usersRes, { data: { user } }] = await Promise.all([
    supabase.from('maintenance_items').select(`
      id, item_number, title, description, status, created_at, updated_at, completed_at,
      contractor_id, trade_id, unit_id, assigned_to, scheduled_date, archived_at,
      unit:units(id, unit_identifier, lot_number, address, access_contact_name, access_contact_phone, settlement_date, owners:unit_owners(id, name, email, phone), project:projects(id, name)),
      trade:trades(id, name),
      contractor:contractors(id, company_name, contact_name, email, phone),
      work_order:work_orders(id, work_order_number),
      extra_trades:maintenance_item_trades(id, maintenance_item_id, trade_id, contractor_id, status, scheduled_date, completed_at, sort_order, created_at, trade:trades(id, name), contractor:contractors(id, company_name))
    `).eq('id', id).order('sort_order', { referencedTable: 'maintenance_item_trades' }).single(),
    supabase.from('activity_log').select('*').eq('maintenance_item_id', id).order('created_at', { ascending: false }),
    supabase.from('contractor_comments').select('*').eq('maintenance_item_id', id).order('created_at'),
    supabase.from('maintenance_item_attachments').select('*').eq('maintenance_item_id', id).order('created_at'),
    supabase.from('contractors').select('id, company_name').order('company_name'),
    supabase.from('item_updates').select('*').eq('maintenance_item_id', id).order('created_at', { ascending: false }),
    supabase.from('profiles').select('id, email, full_name').order('full_name', { nullsFirst: false }).order('email'),
    supabase.auth.getUser(),
  ])

  if (!itemRes.data) notFound()

  const attachments = await withSignedUrls(supabase, attachmentsRes.data ?? [])

  const projectId = (itemRes.data as any).unit?.project?.id
  const [tradesRes, assignmentsRes] = projectId
    ? await Promise.all([
        supabase.from('trades').select('*').eq('project_id', projectId).order('name'),
        supabase.from('project_trade_assignments').select('trade_id, contractor_id').eq('project_id', projectId),
      ])
    : [{ data: [] }, { data: [] }]

  return (
    <div>
      <PageHeader
        backHref="/maintenance"
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
        updates={updatesRes.data ?? []}
        attachments={attachments}
        contractors={contractorsRes.data ?? []}
        trades={tradesRes.data ?? []}
        tradeAssignments={assignmentsRes.data ?? []}
        users={usersRes.data ?? []}
        currentUserId={user?.id ?? ''}
      />
    </div>
  )
}
