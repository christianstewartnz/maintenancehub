import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import PageHeader from '@/components/layout/PageHeader'
import ContractorDetailClient from './ContractorDetailClient'

export const dynamic = 'force-dynamic'

export default async function ContractorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [contractorRes, assignmentsRes, itemsRes] = await Promise.all([
    supabase.from('contractors').select('*').eq('id', id).single(),
    supabase.from('project_trade_assignments').select('*, project:projects(id, name), trade:trades(id, name)').eq('contractor_id', id),
    supabase.from('maintenance_items').select(`
      id, item_number, title, status, priority, created_at,
      unit:units(id, unit_identifier, project:projects(id, name))
    `).eq('contractor_id', id).order('created_at', { ascending: false }).limit(100),
  ])

  if (!contractorRes.data) notFound()

  return (
    <div>
      <PageHeader
        emoji="👷"
        title={contractorRes.data.company_name}
        description={contractorRes.data.contact_name ?? undefined}
        breadcrumbs={[{ label: 'Contractors', href: '/contractors' }, { label: contractorRes.data.company_name }]}
      />
      <ContractorDetailClient
        contractor={contractorRes.data}
        assignments={assignmentsRes.data ?? []}
        items={itemsRes.data ?? []}
      />
    </div>
  )
}
