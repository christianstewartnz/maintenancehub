import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import PortalClient from './PortalClient'
import { createServiceClient } from '@/lib/supabase/service'
import { withSignedUrls } from '@/lib/photos'

export const dynamic = 'force-dynamic'

export default async function PortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase = await createClient()

  const { data: contractor } = await supabase.rpc('get_portal_contractor', { p_token: token })
  if (!contractor || (contractor as any).error) notFound()

  // v2: only items the contractor has been told about (released), each with its
  // responsible staff member as the contact. (get_portal_items is kept for the old deploy.)
  const { data: items } = await supabase.rpc('get_portal_items_v2', { p_token: token })

  // The bucket is private: sign every attachment's URL server-side (token already verified above).
  const list: any[] = (items as any) ?? []
  const service = createServiceClient()
  const signed = await withSignedUrls(service, list.flatMap(i => i.attachments ?? []))
  const byId = new Map(signed.map(a => [a.id, a]))

  // This contractor's latest work order request on each item (pending / approved / declined).
  const latestRequest = new Map<string, any>()
  if (list.length) {
    const { data: requests } = await service
      .from('work_order_requests')
      .select('id, maintenance_item_id, group_id, status, reason, estimated_cost, estimated_hours, response_note, created_at, responded_at')
      .eq('contractor_id', (contractor as any).id)
      .in('maintenance_item_id', list.map(i => i.id))
      .order('created_at', { ascending: false })
    for (const r of requests ?? []) {
      if (!latestRequest.has(r.maintenance_item_id)) latestRequest.set(r.maintenance_item_id, r)
    }
  }

  const withPhotos = list.map(i => ({
    ...i,
    attachments: (i.attachments ?? []).map((a: any) => byId.get(a.id) ?? a),
    wo_request: latestRequest.get(i.id) ?? null,
  }))

  return (
    <PortalClient
      contractor={contractor as any}
      items={withPhotos}
      token={token}
    />
  )
}
