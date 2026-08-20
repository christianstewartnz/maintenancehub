import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import PageHeader from '@/components/layout/PageHeader'
import SettingsClient from './SettingsClient'

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const [{ data: prefs }, { data: projects }] = await Promise.all([
    supabase
      .from('notification_preferences')
      .select('*')
      .eq('user_id', user.id)
      .single(),
    supabase
      .from('projects')
      .select('id, name, address, description, status, created_at, updated_at')
      .eq('status', 'active')
      .order('name'),
  ])

  return (
    <div>
      <PageHeader
        emoji="⚙️"
        title="Settings"
        description="Configure notifications, reports, and SLA thresholds"
      />
      <div style={{ padding: '24px 32px' }}>
        <SettingsClient
          prefs={prefs}
          userId={user.id}
          projects={projects ?? []}
        />
      </div>
    </div>
  )
}
