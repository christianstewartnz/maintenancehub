import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import PortalClient from './PortalClient'

export const dynamic = 'force-dynamic'

export default async function PortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase = await createClient()

  const { data: contractor } = await supabase.rpc('get_portal_contractor', { p_token: token })
  if (!contractor || (contractor as any).error) notFound()

  const { data: items } = await supabase.rpc('get_portal_items', { p_token: token })

  return (
    <PortalClient
      contractor={contractor as any}
      items={(items as any) ?? []}
      token={token}
    />
  )
}
