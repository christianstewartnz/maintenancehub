import { createClient } from '@/lib/supabase/server'
import PageHeader from '@/components/layout/PageHeader'
import NewWorkOrderClient from './NewWorkOrderClient'

export const dynamic = 'force-dynamic'

export default async function NewWorkOrderPage() {
  const supabase = await createClient()

  const [{ data: projects }, { data: contractors }] = await Promise.all([
    supabase.from('projects').select('id, name').eq('status', 'active').order('name'),
    supabase.from('contractors').select('id, company_name, contact_name, email, portal_token').order('company_name'),
  ])

  return (
    <div>
      <PageHeader emoji="📋" title="New Work Order" description="Select items to group and send to a contractor" />
      <NewWorkOrderClient
        projects={projects ?? []}
        contractors={contractors ?? []}
      />
    </div>
  )
}
