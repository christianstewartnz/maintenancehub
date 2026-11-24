import { createClient } from '@/lib/supabase/server'
import PageHeader from '@/components/layout/PageHeader'
import ContractorsClient, { type PendingRow } from './ContractorsClient'
import { fetchMyPendingNotify } from '@/lib/contractor-notify'
import { getSession, isAdmin } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function ContractorsPage() {
  const supabase = await createClient()
  const session = await getSession()
  const admin = isAdmin(session?.profile)
  const [{ data: contractors }, pending] = await Promise.all([
    supabase.from('contractors').select('*').order('company_name'),
    // Pending counts are the user's own items: they only notify about those.
    fetchMyPendingNotify(supabase, session?.user.id ?? ''),
  ])

  // Admins also see how many are waiting on other staff (they can send on their behalf).
  const otherCounts: Record<string, number> = {}
  if (admin) {
    for (const o of pending.others as unknown as PendingRow[]) otherCounts[o.contractor_id] = (otherCounts[o.contractor_id] ?? 0) + 1
  }

  return (
    <div>
      <PageHeader title="Contractors" description="Manage your contractor relationships" />
      <ContractorsClient
        contractors={contractors ?? []}
        pendingItems={pending.mine as unknown as PendingRow[]}
        otherPendingCounts={otherCounts}
      />
    </div>
  )
}
