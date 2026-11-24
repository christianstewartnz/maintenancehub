import { createClient } from '@/lib/supabase/server'
import PageHeader from '@/components/layout/PageHeader'
import SignOffClient from './SignOffClient'
import { effectiveResponsible, fetchProjectStaff, primaryContactByProject } from '@/lib/staff'
import { profileName } from '@/lib/assignees'

export const dynamic = 'force-dynamic'

export default async function SignOffPage() {
  const supabase = await createClient()

  const [{ data: items }, projectsRes, contractorsRes, projectStaff, { data: { user } }] = await Promise.all([
    supabase
      .from('maintenance_items')
      .select(`
        id, item_number, title, description, created_at, updated_at, contractor_id, assigned_to,
        parent:maintenance_items!parent_item_id(assigned_to),
        unit:units(id, unit_identifier, address, project:projects(id, name)),
        contractor:contractors(id, company_name, contact_name, email)
      `)
      .eq('status', 'contractor_complete')
      .eq('has_steps', false) // a job split into steps is signed off through its steps
      .is('archived_at', null)
      .order('updated_at', { ascending: true }),
    supabase.from('projects').select('id, name').eq('status', 'active').order('name'),
    supabase.from('contractors').select('id, company_name').order('company_name'),
    // Main contacts (who an item falls to) and the people for the Responsible filter
    fetchProjectStaff(supabase),
    supabase.auth.getUser(),
  ])

  const itemIds = (items ?? []).map(i => i.id)

  const { data: rawComments } = itemIds.length
    ? await supabase
        .from('contractor_comments')
        .select('id, maintenance_item_id, author, content, created_at')
        .in('maintenance_item_id', itemIds)
        .order('created_at', { ascending: false })
    : { data: null }

  const comments = rawComments ?? []
  type Comment = (typeof comments)[number]
  const lastCommentMap = new Map<string, Comment>()
  for (const c of comments) {
    if (!lastCommentMap.has(c.maintenance_item_id)) lastCommentMap.set(c.maintenance_item_id, c)
  }

  const contactByProject = primaryContactByProject(projectStaff)
  const enriched = (items ?? []).map(({ parent, ...item }) => ({
    ...item,
    // Who it falls to: its own Responsible, else its job's, else the project's main contact
    responsible: effectiveResponsible(
      item.assigned_to,
      (parent as unknown as { assigned_to: string | null } | null)?.assigned_to,
      contactByProject.get((item.unit as unknown as { project?: { id: string } } | null)?.project?.id ?? ''),
    ),
    lastComment: lastCommentMap.get(item.id) ?? null,
  }))
  // Everyone on my projects, for the "X's items" filter choices
  const users = [...new Map(projectStaff.filter(s => s.profile?.is_active).map(s => [s.user_id, s.profile!])).values()]
    .sort((a, b) => profileName(a).localeCompare(profileName(b)))

  return (
    <div>
      <PageHeader
        title="Sign-off Queue"
        description="Contractor-complete items awaiting your confirmation"
      />
      <SignOffClient
        items={enriched}
        projects={projectsRes.data ?? []}
        contractors={contractorsRes.data ?? []}
        users={users}
        currentUserId={user?.id ?? ''}
      />
    </div>
  )
}
