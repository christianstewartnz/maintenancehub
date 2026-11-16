import { createClient } from '@/lib/supabase/server'
import PageHeader from '@/components/layout/PageHeader'
import DashboardClient from './DashboardClient'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const supabase = await createClient()

  const itemSelect = `
    id, item_number, title, status, created_at, updated_at, scheduled_date,
    unit:units(id, unit_identifier, address, project_id, project:projects(id, name)),
    contractor:contractors(id, company_name)
  `

  const [projectsRes, openItemsRes, scheduledItemsRes] = await Promise.all([
    supabase.from('projects').select('*').eq('status', 'active').order('name'),
    supabase
      .from('maintenance_items')
      .select(itemSelect)
      .not('status', 'in', '(complete)')
      .is('archived_at', null)
      .order('created_at', { ascending: false }),
    // Fetch all items with a scheduled_date (including complete) so calendar shows full picture
    supabase
      .from('maintenance_items')
      .select(itemSelect)
      .not('scheduled_date', 'is', null)
      .is('archived_at', null)
      .order('scheduled_date', { ascending: true }),
  ])

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Open maintenance items across all active projects"
      />
      <DashboardClient
        projects={projectsRes.data ?? []}
        items={(openItemsRes.data ?? []) as any}
        scheduledItems={(scheduledItemsRes.data ?? []) as any}
        loadedAt={Date.now()}
      />
    </div>
  )
}
