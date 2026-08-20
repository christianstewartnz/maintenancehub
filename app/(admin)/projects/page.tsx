import { createClient } from '@/lib/supabase/server'
import PageHeader from '@/components/layout/PageHeader'
import ProjectsClient from './ProjectsClient'

export const dynamic = 'force-dynamic'

export default async function ProjectsPage() {
  const supabase = await createClient()

  const { data: projects } = await supabase
    .from('projects')
    .select(`
      *,
      units:units(count),
      maintenance_items:maintenance_items(count)
    `)
    .order('name')

  return (
    <div>
      <PageHeader
        emoji="📁"
        title="Projects"
        description="Manage your property development projects"
      />
      <ProjectsClient projects={projects ?? []} />
    </div>
  )
}
