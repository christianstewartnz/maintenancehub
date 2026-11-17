import { createClient } from '@/lib/supabase/server'
import PageHeader from '@/components/layout/PageHeader'
import MaintenanceClient from './MaintenanceClient'
import { LIST_SELECT } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function MaintenancePage() {
  const supabase = await createClient()

  const [itemsRes, projectsRes, contractorsRes, usersRes, tradesRes, { data: { user } }] = await Promise.all([
    supabase
      .from('maintenance_items')
      .select(LIST_SELECT)
      .order('created_at', { ascending: false })
      .limit(500),
    supabase.from('projects').select('id, name').eq('status', 'active').order('name'),
    supabase.from('contractors').select('id, company_name').order('company_name'),
    supabase.from('profiles').select('id, email, full_name').order('full_name', { nullsFirst: false }).order('email'),
    supabase.from('trades').select('id, name, project_id').order('name'),
    supabase.auth.getUser(),
  ])
  const { data: tradeAssignments } = await supabase.from('project_trade_assignments').select('project_id, trade_id, contractor_id')

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
        tradeAssignments={tradeAssignments ?? []}
        currentUserId={user?.id ?? ''}
      />
    </div>
  )
}
