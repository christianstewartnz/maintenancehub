import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Sidebar from '@/components/layout/Sidebar'
import { NavigationTracker } from '@/components/layout/BackButton'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <NavigationTracker />
      <Sidebar />
      <main style={{ flex: 1, overflow: 'auto', background: '#ffffff', minWidth: 0 }}>
        {children}
      </main>
    </div>
  )
}
