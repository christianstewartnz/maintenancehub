import { createClient } from '@/lib/supabase/server'
import PageHeader from '@/components/layout/PageHeader'
import ContractorsClient from './ContractorsClient'

export const dynamic = 'force-dynamic'

export default async function ContractorsPage() {
  const supabase = await createClient()
  const { data: contractors } = await supabase
    .from('contractors')
    .select('*')
    .order('company_name')

  return (
    <div>
      <PageHeader emoji="👷" title="Contractors" description="Manage your contractor relationships" />
      <ContractorsClient contractors={contractors ?? []} />
    </div>
  )
}
