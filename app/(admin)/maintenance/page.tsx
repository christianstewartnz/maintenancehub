import { createClient } from '@/lib/supabase/server'
import PageHeader from '@/components/layout/PageHeader'
import MaintenanceClient from './MaintenanceClient'

export const dynamic = 'force-dynamic'

export default async function MaintenancePage() {
  const supabase = await createClient()

  const [itemsRes, projectsRes, contractorsRes, usersRes, tradesRes, { data: { user } }] = await Promise.all([
    supabase
      .from('maintenance_items')
      .select(`
        id, item_number, title, status, created_at, updated_at, assigned_to, contractor_id, trade_id, archived_at,
        unit:units(id, unit_identifier, address, project_id, project:projects(id, name)),
        trade:trades(id, name),
        contractor:contractors(id, company_name),
        work_order:work_orders(id, work_order_number)
      `)
      .order('created_at', { ascending: false })
      .limit(500),
    supabase.from('projects').select('id, name').eq('status', 'active').order('name'),
    supabase.from('contractors').select('id, company_name').order('company_name'),
    supabase.from('profiles').select('id, email, full_name').order('full_name', { nullsFirst: false }).order('email'),
    supabase.from('trades').select('id, name, project_id').order('name'),
    supabase.auth.getUser(),
  ])

  return (
    <div>
      <PageHeader
        title="Maintenance Items"
        description="Log and track all maintenance jobs"
      />
      <MaintenanceClient
        items={(itemsRes.data ?? []) as any}
        projects={projectsRes.data ?? []}
        contractors={contractorsRes.data ?? []}
        users={usersRes.data ?? []}
        trades={tradesRes.data ?? []}
        currentUserId={user?.id ?? ''}
      />
    </div>
  )
}
