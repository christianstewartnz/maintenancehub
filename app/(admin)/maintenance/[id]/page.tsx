import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import PageHeader from '@/components/layout/PageHeader'
import ItemDetailClient from './ItemDetailClient'
import { withSignedUrls } from '@/lib/photos'
import { STEP_SELECT, WORK_ORDER_REQUEST_SELECT } from '@/lib/types'
import { fetchProjectStaff } from '@/lib/staff'

export const dynamic = 'force-dynamic'

export default async function MaintenanceItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [itemRes, activityRes, commentsRes, attachmentsRes, contractorsRes, updatesRes, usersRes, { data: { user } }, woRequestsRes] = await Promise.all([
    supabase.from('maintenance_items').select(`
      id, item_number, title, description, status, created_at, updated_at, completed_at,
      contractor_id, trade_id, unit_id, assigned_to, scheduled_date, archived_at, parent_item_id, step_order, has_steps,
      unit:units(id, unit_identifier, lot_number, address, access_contact_name, access_contact_phone, settlement_date, maintenance_reminder_sent_at, owners:unit_owners(id, name, email, phone), project:projects(id, name)),
      trade:trades(id, name),
      contractor:contractors(id, company_name, contact_name, email, phone),
      work_order:work_orders(id, work_order_number)
    `).eq('id', id).single(),
    supabase.from('activity_log').select('*').eq('maintenance_item_id', id).order('created_at', { ascending: false }),
    supabase.from('contractor_comments').select('*').eq('maintenance_item_id', id).order('created_at'),
    supabase.from('maintenance_item_attachments').select('*').eq('maintenance_item_id', id).order('created_at'),
    supabase.from('contractors').select('id, company_name').order('company_name'),
    supabase.from('item_updates').select('*').eq('maintenance_item_id', id).order('created_at', { ascending: false }),
    supabase.from('profiles').select('id, email, full_name').order('full_name', { nullsFirst: false }).order('email'),
    supabase.auth.getUser(),
    supabase.from('work_order_requests').select(WORK_ORDER_REQUEST_SELECT).eq('maintenance_item_id', id).order('created_at', { ascending: false }),
  ])

  if (!itemRes.data) notFound()

  const attachments = await withSignedUrls(supabase, attachmentsRes.data ?? [])

  const projectId = (itemRes.data as any).unit?.project?.id
  // A job lists its own steps; a step shows its job and the other steps on it
  const parentId = itemRes.data.parent_item_id ?? null
  const familyId = parentId ?? itemRes.data.id
  const [tradesRes, assignmentsRes, stepsRes, parentRes, projectStaff] = await Promise.all([
    projectId ? supabase.from('trades').select('*').eq('project_id', projectId).order('name') : Promise.resolve({ data: [] }),
    projectId ? supabase.from('project_trade_assignments').select('trade_id, contractor_id').eq('project_id', projectId) : Promise.resolve({ data: [] }),
    supabase.from('maintenance_items').select(STEP_SELECT).eq('parent_item_id', familyId).order('step_order'),
    parentId
      ? supabase.from('maintenance_items').select('id, item_number, title, description, status, archived_at, assigned_to').eq('id', parentId).single()
      : Promise.resolve({ data: null }),
    // The project's staff: Responsible choices and the main contact it falls back to
    projectId ? fetchProjectStaff(supabase, [projectId]) : Promise.resolve([]),
  ])

  return (
    <div>
      <PageHeader
        backHref="/maintenance"
        title={itemRes.data.item_number}
        description={itemRes.data.title}
        breadcrumbs={[
          { label: 'Maintenance', href: '/maintenance' },
          ...(parentRes.data ? [{ label: (parentRes.data as any).item_number, href: `/maintenance/${(parentRes.data as any).id}` }] : []),
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
        tradeAssignments={(assignmentsRes.data ?? []) as { trade_id: string; contractor_id: string }[]}
        steps={(stepsRes.data ?? []) as any}
        parent={parentRes.data as any}
        users={usersRes.data ?? []}
        projectStaff={projectStaff}
        currentUserId={user?.id ?? ''}
        woRequests={(woRequestsRes.data ?? []) as any}
      />
    </div>
  )
}
