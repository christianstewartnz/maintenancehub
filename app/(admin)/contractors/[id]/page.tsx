import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import PageHeader from '@/components/layout/PageHeader'
import ContractorDetailClient from './ContractorDetailClient'
import { NOT_PENDING_FILTER } from '@/lib/contractor-notify'
import type { PendingNotifyItem } from '@/components/ui/NotifyContractorModal'

export const dynamic = 'force-dynamic'

export default async function ContractorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [contractorRes, assignmentsRes, itemsRes, pendingRes, lastNotifiedRes] = await Promise.all([
    supabase.from('contractors').select('*').eq('id', id).single(),
    supabase.from('project_trade_assignments').select('*, project:projects(id, name), trade:trades(id, name)').eq('contractor_id', id),
    supabase.from('maintenance_items').select(`
      id, item_number, title, status, created_at, contractor_notified_at,
      unit:units(id, unit_identifier, address, project:projects(id, name))
    `).eq('contractor_id', id).order('created_at', { ascending: false }).limit(100),
    supabase.from('maintenance_items')
      .select('id, item_number, title, unit:units(unit_identifier, address, project:projects(name))')
      .eq('contractor_id', id)
      .is('contractor_notified_at', null)
      .not('status', 'in', NOT_PENDING_FILTER)
      .order('created_at'),
    supabase.from('maintenance_items')
      .select('contractor_notified_at')
      .eq('contractor_id', id)
      .not('contractor_notified_at', 'is', null)
      .order('contractor_notified_at', { ascending: false })
      .limit(1),
  ])

  if (!contractorRes.data) notFound()

  return (
    <div>
      <PageHeader
        title={contractorRes.data.company_name}
        description={contractorRes.data.contact_name ?? undefined}
        breadcrumbs={[{ label: 'Contractors', href: '/contractors' }, { label: contractorRes.data.company_name }]}
      />
      <ContractorDetailClient
        contractor={contractorRes.data}
        assignments={assignmentsRes.data ?? []}
        items={itemsRes.data ?? []}
        pendingItems={(pendingRes.data ?? []) as unknown as PendingNotifyItem[]}
        lastNotifiedAt={lastNotifiedRes.data?.[0]?.contractor_notified_at ?? null}
      />
    </div>
  )
}
