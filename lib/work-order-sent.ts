import type { createClient } from '@/lib/supabase/server'

type Client = Awaited<ReturnType<typeof createClient>>

/**
 * Marks a work order as sent. From then on it can't be edited (notes are locked by a
 * DB trigger; items by the edit route). A re-send keeps the original status/date
 * if it's already moved past draft.
 */
export async function markWorkOrderSent(
  supabase: Client,
  workOrder: { id: string; status: string; sent_at: string | null },
): Promise<{ error: string | null }> {
  if (workOrder.status !== 'draft') return { error: null }
  const { error } = await supabase
    .from('work_orders')
    .update({ status: 'sent', sent_at: workOrder.sent_at ?? new Date().toISOString() })
    .eq('id', workOrder.id)
  return { error: error?.message ?? null }
}
