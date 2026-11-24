import type { SupabaseClient } from '@supabase/supabase-js'
import type { NotificationPreferences } from '@/lib/types'

/** Per-user on/off switches in notification_preferences. */
export type NotifyToggle = 'contractor_complete_email' | 'contractor_comment_email' | 'maintenance_due_email'

export interface Recipient {
  userId: string
  email: string
  prefs: NotificationPreferences
}

/** A user's notification address: their own override, else their login email. */
export function recipientEmail(prefs: Pick<NotificationPreferences, 'notify_email'> | null, loginEmail?: string | null) {
  return prefs?.notify_email?.trim() || loginEmail || null
}

/**
 * Every user who has this notification switched on, with the address to send to.
 * Needs a service-role client (reads all users' preferences and auth emails).
 */
export async function getRecipients(service: SupabaseClient, toggle: NotifyToggle): Promise<Recipient[]> {
  const { data: rows } = await service
    .from('notification_preferences')
    .select('*')
    .eq(toggle, true)
  return resolve(service, (rows ?? []) as NotificationPreferences[])
}

/**
 * Who gets a contractor alert (completed / commented) about one item:
 *  - the item's responsible person (mh_item_responsible: Responsible → parent job's → project main contact), and
 *  - active admins who chose "alerts for all projects",
 * in both cases only if they have this alert switched on and are active.
 * Needs a service-role client.
 */
export async function getItemAlertRecipients(
  service: SupabaseClient,
  toggle: NotifyToggle,
  itemId: string,
): Promise<Recipient[]> {
  const [{ data: responsibleId }, { data: rows }, { data: profiles }] = await Promise.all([
    service.rpc('mh_item_responsible', { p_item_id: itemId }),
    service.from('notification_preferences').select('*').eq(toggle, true),
    service.from('profiles').select('id, role, is_active'),
  ])
  const byId = new Map((profiles ?? []).map(p => [p.id as string, p as { role: string; is_active: boolean }]))
  const chosen = ((rows ?? []) as NotificationPreferences[]).filter(prefs => {
    const p = byId.get(prefs.user_id)
    if (!p?.is_active) return false
    if (prefs.user_id === responsibleId) return true
    return p.role === 'admin' && prefs.alerts_all_projects
  })
  return resolve(service, chosen)
}

/** Resolves preference rows to recipients, dropping users without any address. */
export async function resolve(service: SupabaseClient, rows: NotificationPreferences[]): Promise<Recipient[]> {
  const out: Recipient[] = []
  const seen = new Set<string>()
  for (const prefs of rows) {
    let email = recipientEmail(prefs)
    if (!email) {
      const { data } = await service.auth.admin.getUserById(prefs.user_id)
      email = recipientEmail(prefs, data.user?.email)
    }
    if (!email || seen.has(email.toLowerCase())) continue
    seen.add(email.toLowerCase())
    out.push({ userId: prefs.user_id, email, prefs })
  }
  return out
}
