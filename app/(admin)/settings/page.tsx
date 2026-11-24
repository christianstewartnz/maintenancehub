import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { redirect } from 'next/navigation'
import PageHeader from '@/components/layout/PageHeader'
import SettingsClient from './SettingsClient'
import ProfileNameCard from './ProfileNameCard'
import ChangePasswordCard from './ChangePasswordCard'
import TeamCard, { type TeamUser } from './TeamCard'
import { senderAddress } from '@/lib/mailer'
import { getSession, isAdmin } from '@/lib/auth'
import { STAFF_PROFILE_SELECT, type StaffProfile } from '@/lib/types'

/** Team data for admins: every user, their sign-in status and project assignments (service client). */
async function loadTeam() {
  const service = createServiceClient()
  const [{ data: profiles }, { data: staff }, { data: projects }, { data: authList }] = await Promise.all([
    service.from('profiles').select(STAFF_PROFILE_SELECT).order('full_name'),
    service.from('project_staff').select('project_id, user_id, is_primary'),
    service.from('projects').select('id, name, status').order('name'),
    service.auth.admin.listUsers({ perPage: 1000 }),
  ])
  const authById = new Map((authList?.users ?? []).map(u => [u.id, u]))
  const users: TeamUser[] = ((profiles ?? []) as StaffProfile[]).map(p => {
    const a = authById.get(p.id)
    return {
      ...p,
      // Never signed in = hasn't accepted their invite yet.
      invitePending: !!a && !a.last_sign_in_at,
      lastSignInAt: a?.last_sign_in_at ?? null,
    }
  })
  return {
    users,
    staff: (staff ?? []) as { project_id: string; user_id: string; is_primary: boolean }[],
    projects: (projects ?? []) as { id: string; name: string; status: string }[],
  }
}

export default async function SettingsPage() {
  const session = await getSession()
  if (!session) redirect('/auth/login')
  const { user, profile } = session
  const admin = isAdmin(profile)
  const supabase = await createClient()

  const [{ data: prefs }, { data: projects }, team] = await Promise.all([
    supabase
      .from('notification_preferences')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle(),
    // RLS limits staff to their own projects, so report choices are already scoped.
    supabase
      .from('projects')
      .select('id, name, address, description, status, development_company, created_at, updated_at')
      .eq('status', 'active')
      .order('name'),
    admin ? loadTeam() : Promise.resolve(null),
  ])

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Configure notifications, reports, and SLA thresholds"
      />
      <div className="page-content" style={{ padding: '24px 32px' }}>
        <ProfileNameCard userId={user.id} email={user.email ?? null} fullName={profile.full_name} phone={profile.phone} />
        <ChangePasswordCard />
        {team && <TeamCard currentUserId={user.id} users={team.users} staff={team.staff} projects={team.projects} />}
        <SettingsClient
          prefs={prefs}
          userId={user.id}
          loginEmail={user.email ?? null}
          senderEmail={senderAddress()}
          projects={projects ?? []}
          isAdmin={admin}
        />
      </div>
    </div>
  )
}
