import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { refuseIfNotVisible } from '../../_lib/visible'

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const { item_id, scheduled_date } = await req.json()

  if (!item_id) return NextResponse.json({ error: 'item_id required' }, { status: 400 })

  const supabase = createServiceClient()

  const { data: contractor } = await supabase
    .from('contractors')
    .select('id, company_name')
    .eq('portal_token', token)
    .single()

  if (!contractor) return NextResponse.json({ error: 'Invalid token' }, { status: 401 })

  const { data: item } = await supabase
    .from('maintenance_items')
    .select('id, contractor_id')
    .eq('id', item_id)
    .single()

  if (!item || item.contractor_id !== contractor.id) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 403 })
  }
  // Only items shown on their portal (released, open, not hidden).
  const refused = await refuseIfNotVisible(supabase, token, item_id)
  if (refused) return refused

  const { error } = await supabase
    .from('maintenance_items')
    .update({ scheduled_date: scheduled_date || null })
    .eq('id', item_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Booking a date means the contractor is on it: Logged/Assigned → In Progress
  const { data: status } = scheduled_date
    ? await supabase.rpc('portal_mark_started', { p_token: token, p_item_id: item_id })
    : { data: null }

  return NextResponse.json({ ok: true, status })
}
