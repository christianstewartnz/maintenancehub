import { createClient } from '@/lib/supabase/server'
import PageHeader from '@/components/layout/PageHeader'
import DashboardClient from './DashboardClient'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const supabase = await createClient()

  const [projectsRes, itemsRes] = await Promise.all([
    supabase.from('projects').select('*').eq('status', 'active').order('name'),
    supabase
      .from('maintenance_items')
      .select(`
        id, item_number, title, status, priority, created_at, updated_at,
        unit:units(id, unit_identifier, address, project_id, project:projects(id, name)),
        contractor:contractors(id, company_name)
      `)
      .not('status', 'in', '(complete)')
      .order('created_at', { ascending: false }),
  ])

  return (
    <div>
      <PageHeader
        emoji="📊"
        title="Dashboard"
        description="Open maintenance items across all active projects"
      />
      <DashboardClient
        projects={projectsRes.data ?? []}
        items={(itemsRes.data ?? []) as any}
      />
    </div>
  )
}
