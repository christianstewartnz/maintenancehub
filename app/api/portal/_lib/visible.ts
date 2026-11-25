import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Can this portal token act on this item? Same rule as the portal list
 * (get_portal_items_v2): the contractor's item, open, not archived and not hidden.
 * Fails closed on any error.
 *
 * Returns a 403 Response to send back, or null if the item is visible.
 * Works with an anon or service-role client (portal_item_visible is security definer).
 */
export async function refuseIfNotVisible(client: SupabaseClient, token: string, itemId: unknown): Promise<Response | null> {
  if (typeof itemId !== 'string' || !itemId) return Response.json({ error: 'item_id required' }, { status: 400 })
  const { data, error } = await client.rpc('portal_item_visible', { p_token: token, p_item_id: itemId })
  if (error || data !== true) return Response.json({ error: 'Not authorised' }, { status: 403 })
  return null
}
