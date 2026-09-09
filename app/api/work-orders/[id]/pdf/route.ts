import { createClient } from '@/lib/supabase/server'
import { generateWorkOrderPDF } from '@/lib/generate-pdf'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const [{ data: workOrder }, { data: items }] = await Promise.all([
    supabase
      .from('work_orders')
      .select('*, project:projects(id, name, address), contractor:contractors(id, company_name, contact_name, email, phone)')
      .eq('id', id)
      .single(),
    supabase
      .from('maintenance_items')
      .select('*, unit:units(id, unit_identifier, lot_number, address, access_contact_name, access_contact_phone, owners:unit_owners(id, name, phone)), trade:trades(name)')
      .eq('work_order_id', id)
      .order('created_at'),
  ])

  if (!workOrder) return new Response('Not found', { status: 404 })

  const buffer = await generateWorkOrderPDF(workOrder, items ?? [])

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${workOrder.work_order_number}.pdf"`,
    },
  })
}
