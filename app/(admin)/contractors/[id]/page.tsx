import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import PageHeader from '@/components/layout/PageHeader'
import ContractorDetailClient from './ContractorDetailClient'
import { fetchMyPendingNotify, withResponsible } from '@/lib/contractor-notify'
import type { PendingNotifyItem } from '@/components/ui/NotifyContractorModal'
import { getSession, isAdmin } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function ContractorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const session = await getSession()
  const me = session?.user.id ?? ''
  const admin = isAdmin(session?.profile)

  const [contractorRes, assignmentsRes, itemsRes, pending, lastNotifiedRes, contactsRes] = await Promise.all([
    supabase.from('contractors').select('*').eq('id', id).single(),
    supabase.from('project_trade_assignments').select('*, project:projects(id, name), trade:trades(id, name)').eq('contractor_id', id),
    supabase.from('maintenance_items').select(`
      id, item_number, title, status, created_at, completed_at, contractor_notified_at, portal_hidden,
      assigned_to, parent_item_id,
      unit:units(id, project_id, unit_identifier, address, project:projects(id, name))
    `).eq('contractor_id', id).is('archived_at', null).order('created_at', { ascending: false }).limit(500),
    // The Notify card is the user's own items: they only notify about those.
    fetchMyPendingNotify(supabase, me, { contractorId: id }),
    supabase.from('maintenance_items')
      .select('contractor_notified_at')
      .eq('contractor_id', id)
      .not('contractor_notified_at', 'is', null)
      .order('contractor_notified_at', { ascending: false })
      .limit(1),
    supabase.from('contractor_contacts').select('*').eq('contractor_id', id).order('created_at'),
  ])

  if (!contractorRes.data) notFound()

  // responsible_id lets "Show in portal" put an item back on the user's Notify list only if it's theirs.
  const items = await withResponsible(supabase, (itemsRes.data ?? []) as unknown as Parameters<typeof withResponsible>[1])

  return (
    <div>
      <PageHeader
        backHref="/contractors"
        title={contractorRes.data.company_name}
        description={contractorRes.data.contact_name ?? undefined}
        breadcrumbs={[{ label: 'Contractors', href: '/contractors' }, { label: contractorRes.data.company_name }]}
      />
      <ContractorDetailClient
        contractor={contractorRes.data}
        contacts={contactsRes.data ?? []}
        assignments={assignmentsRes.data ?? []}
        items={items}
        pendingItems={pending.mine as unknown as PendingNotifyItem[]}
        otherPendingCount={admin ? pending.others.length : 0}
        lastNotifiedAt={lastNotifiedRes.data?.[0]?.contractor_notified_at ?? null}
        isAdmin={admin}
        userId={me}
      />
    </div>
  )
}
