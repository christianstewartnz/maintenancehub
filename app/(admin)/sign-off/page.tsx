import { createClient } from '@/lib/supabase/server'
import PageHeader from '@/components/layout/PageHeader'
import SignOffClient from './SignOffClient'

export const dynamic = 'force-dynamic'

export default async function SignOffPage() {
  const supabase = await createClient()

  const [{ data: items }, projectsRes, contractorsRes, usersRes, { data: { user } }] = await Promise.all([
    supabase
      .from('maintenance_items')
      .select(`
        id, item_number, title, description, created_at, updated_at, contractor_id, assigned_to,
        unit:units(id, unit_identifier, address, project:projects(id, name)),
        contractor:contractors(id, company_name, contact_name, email)
      `)
      .eq('status', 'contractor_complete')
      .eq('has_steps', false) // a job split into steps is signed off through its steps
      .is('archived_at', null)
      .order('updated_at', { ascending: true }),
    supabase.from('projects').select('id, name').eq('status', 'active').order('name'),
    supabase.from('contractors').select('id, company_name').order('company_name'),
    supabase.from('profiles').select('id, email, full_name').order('full_name', { nullsFirst: false }).order('email'),
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

  const enriched = (items ?? []).map(item => ({
    ...item,
    lastComment: lastCommentMap.get(item.id) ?? null,
  }))

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
        users={usersRes.data ?? []}
        currentUserId={user?.id ?? ''}
      />
    </div>
  )
}
