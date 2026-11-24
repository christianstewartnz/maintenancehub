import { createClient } from '@/lib/supabase/server'
import PageHeader from '@/components/layout/PageHeader'
import ProjectsClient from './ProjectsClient'
import { getSession, isAdmin } from '@/lib/auth'
import { fetchProjectStaff } from '@/lib/staff'
import { profileName } from '@/lib/assignees'

export const dynamic = 'force-dynamic'

export default async function ProjectsPage() {
  const supabase = await createClient()

  const [{ data: projects }, projectStaff, session] = await Promise.all([
    supabase
      .from('projects')
      .select(`
      *,
      units:units(count)
    `)
      .order('name'),
    fetchProjectStaff(supabase),
    getSession(),
  ])

  // project_id → main contact's name, shown on each card
  const mainContacts: Record<string, string> = {}
  for (const s of projectStaff) if (s.is_primary && s.profile) mainContacts[s.project_id] = profileName(s.profile)

  return (
    <div>
      <PageHeader
        title="Projects"
        description="Manage your property development projects"
      />
      <ProjectsClient
        projects={projects ?? []}
        mainContacts={mainContacts}
        isAdmin={isAdmin(session?.profile)}
        currentUserId={session?.user.id ?? ''}
      />
    </div>
  )
}
