import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

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

  const { error } = await supabase
    .from('maintenance_items')
    .update({ scheduled_date: scheduled_date || null })
    .eq('id', item_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
