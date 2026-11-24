import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getSession, isAdmin } from '@/lib/auth'
import Sidebar from '@/components/layout/Sidebar'
import { NavigationTracker } from '@/components/layout/BackButton'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session) redirect('/auth/login')

  // A deactivated user is signed out (an admin also bans them in auth, so the session can't refresh).
  if (!session.profile.is_active) {
    const supabase = await createClient()
    await supabase.auth.signOut()
    redirect('/auth/login?deactivated=1')
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <NavigationTracker />
      <Sidebar isAdmin={isAdmin(session.profile)} />
      <main style={{ flex: 1, overflow: 'auto', background: '#ffffff', minWidth: 0 }}>
        {children}
      </main>
    </div>
  )
}
