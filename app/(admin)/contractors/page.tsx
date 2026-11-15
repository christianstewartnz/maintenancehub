import { createClient } from '@/lib/supabase/server'
import PageHeader from '@/components/layout/PageHeader'
import ContractorsClient, { type PendingRow } from './ContractorsClient'
import { NOT_PENDING_FILTER } from '@/lib/contractor-notify'

export const dynamic = 'force-dynamic'

export default async function ContractorsPage() {
  const supabase = await createClient()
  const [{ data: contractors }, { data: pending }] = await Promise.all([
    supabase.from('contractors').select('*').order('company_name'),
    supabase
      .from('maintenance_items')
      .select('id, item_number, title, contractor_id, unit:units(unit_identifier, address, project:projects(name))')
      .not('contractor_id', 'is', null)
      .is('contractor_notified_at', null)
      .not('status', 'in', NOT_PENDING_FILTER)
      .order('created_at'),
  ])

  return (
    <div>
      <PageHeader title="Contractors" description="Manage your contractor relationships" />
      <ContractorsClient contractors={contractors ?? []} pendingItems={(pending ?? []) as unknown as PendingRow[]} />
    </div>
  )
}
