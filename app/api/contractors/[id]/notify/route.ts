import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { sendEmail, isEmailConfigured } from '@/lib/mailer'
import { contractorNewItemsEmail } from '@/lib/email-templates'
import { fetchMyPendingNotify, PENDING_NOTIFY_SELECT } from '@/lib/contractor-notify'
import { requireUser, isAdmin } from '@/lib/auth'
import { buildOutlookDraft, attachmentDisposition } from '@/lib/outlook-draft'

interface PendingItem {
  id: string
  item_number: string
  title: string
  assigned_to: string | null
  parent_item_id: string | null
  unit: {
    project_id: string
    unit_identifier: string | null
    address: string | null
    project: { name: string } | null
    owners: { name: string; email: string | null; phone: string | null }[] | null
  } | null
}

const EMAIL_SELECT =
  'id, item_number, title, assigned_to, parent_item_id, unit:units(project_id, unit_identifier, address, project:projects(name), owners:unit_owners(name, email, phone))'

type Client = Awaited<ReturnType<typeof createClient>>

/**
 * Everyone a Notify goes to: the contractor's main email plus each extra contact's
 * email (contractor_contacts), deduplicated, in one email. `greeting` is their first
 * names ("Dave and Sam"), or null if none are known.
 */
async function contractorRecipients(
  supabase: Client,
  contractor: { id: string; email: string | null; contact_name: string | null },
): Promise<{ emails: string[]; greeting: string | null }> {
  const { data: contacts } = await supabase
    .from('contractor_contacts')
    .select('name, email, created_at')
    .eq('contractor_id', contractor.id)
    .order('created_at')
  const people = [
    { name: contractor.contact_name, email: contractor.email },
    ...((contacts ?? []) as { name: string | null; email: string | null }[]),
  ]

  const emails: string[] = []
  const firstNames: string[] = []
  for (const p of people) {
    // A cell may hold several addresses ("a@x.nz; b@x.nz").
    const addrs = (p.email ?? '').split(/[;,\s]+/).map(e => e.trim()).filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
    const fresh = addrs.filter(e => !emails.some(x => x.toLowerCase() === e.toLowerCase()))
    emails.push(...fresh)
    const first = p.name?.trim().split(/\s+/)[0]
    // Greet people who receive it (or the main contact, who always appears first).
    if (first && (fresh.length || p === people[0]) && !firstNames.includes(first)) firstNames.push(first)
  }
  const greeting = firstNames.length <= 1
    ? firstNames[0] ?? null
    : `${firstNames.slice(0, -1).join(', ')} and ${firstNames[firstNames.length - 1]}`
  return { emails, greeting }
}

/** "Christian Stewart", else the email's local part. */
function displayName(p: { full_name: string | null; email: string | null } | undefined): string {
  return p?.full_name?.trim() || p?.email?.split('@')[0] || 'Unknown'
}

/**
 * GET /api/contractors/[id]/notify
 *
 * What the Notify dialog says about this contractor's pending items that are NOT
 * the signed-in user's (their effective responsible is someone else):
 *  - admin: { others: { count, people: [{ name, count }], items } } — admins can see
 *    every item, and may tick "include other staff's items" to send on their behalf.
 *  - staff: { others: { count } } — just a number. Counted with the service client
 *    because RLS hides items on projects they aren't on; nothing else is returned.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const guard = await requireUser()
  if (guard.error) return guard.error
  const me = guard.session.user.id
  const supabase = await createClient()

  // Who the email / Outlook draft will go to, for the dialog.
  const { data: contractor } = await supabase.from('contractors').select('id, email, contact_name').eq('id', id).single()
  const recipients = contractor ? (await contractorRecipients(supabase, contractor)).emails : []

  if (isAdmin(guard.session.profile)) {
    const { others, error } = await fetchMyPendingNotify(supabase, me, { select: PENDING_NOTIFY_SELECT, contractorId: id })
    if (error) return Response.json({ error }, { status: 500 })

    const ids = [...new Set(others.map(o => o.responsible_id).filter((x): x is string => !!x))]
    const { data: profiles } = ids.length
      ? await supabase.from('profiles').select('id, full_name, email').in('id', ids)
      : { data: [] }
    const byId = new Map((profiles ?? []).map(p => [p.id as string, p as { full_name: string | null; email: string | null }]))
    const nameOf = (uid: string | null) => (uid ? displayName(byId.get(uid)) : 'No one (no main contact)')

    const counts = new Map<string, number>()
    for (const o of others) counts.set(nameOf(o.responsible_id), (counts.get(nameOf(o.responsible_id)) ?? 0) + 1)

    return Response.json({
      recipients,
      others: {
        count: others.length,
        people: Array.from(counts, ([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
        items: others.map(o => ({ ...o, responsible_name: nameOf(o.responsible_id) })),
      },
    })
  }

  const { others, error } = await fetchMyPendingNotify(createServiceClient(), me, { contractorId: id })
  if (error) return Response.json({ error }, { status: 500 })
  return Response.json({ recipients, others: { count: others.length } })
}

/**
 * POST /api/contractors/[id]/notify
 * Body: { mode?: 'email' | 'outlook' | 'mark', item_ids?: string[], message?: string, include_others?: boolean }
 *
 *  - mode 'email' (default): email the contractor a summary of their pending
 *    items + portal link, then stamp those items as notified.
 *  - mode 'outlook': same email, returned as an Outlook draft (.eml download) for the
 *    user to send themselves, then stamp. For when app email sending is down.
 *  - mode 'mark': stamp them as notified without sending (e.g. told by phone).
 *
 * Only items the sender is responsible for (mh_item_responsible / effectiveResponsible)
 * are included. Admins can pass include_others to also send everyone else's ("on
 * behalf of"); it's ignored for staff.
 *
 * `message` is an optional note added near the top of the email (ignored for 'mark').
 *
 * `item_ids` limits the action to the items the user previewed, so an item
 * assigned while the dialog was open isn't silently marked as told.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const guard = await requireUser()
  if (guard.error) return guard.error
  const { user, profile } = guard.session
  const supabase = await createClient()

  const body = await req.json().catch(() => ({})) as { mode?: string; item_ids?: unknown; message?: unknown; include_others?: unknown }
  const mode = body.mode === 'mark' ? 'mark' : body.mode === 'outlook' ? 'outlook' : 'email'
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, 4000) || null : null
  const onlyIds = Array.isArray(body.item_ids) ? new Set(body.item_ids.filter((x): x is string => typeof x === 'string')) : null
  const includeOthers = body.include_others === true && isAdmin(profile)

  const { data: contractor } = await supabase
    .from('contractors')
    .select('id, company_name, contact_name, email, portal_token')
    .eq('id', id)
    .single()
  if (!contractor) return Response.json({ error: 'Contractor not found' }, { status: 404 })

  // The user's own client: RLS already limits staff to their projects.
  const { mine, others, error: itemsErr } = await fetchMyPendingNotify<PendingItem>(supabase, user.id, { select: EMAIL_SELECT, contractorId: id })
  if (itemsErr) return Response.json({ error: itemsErr }, { status: 500 })
  const items = (includeOthers ? [...mine, ...others] : mine).filter(i => !onlyIds || onlyIds.has(i.id))
  if (items.length === 0) {
    return Response.json({ error: 'No new items of yours to notify this contractor about' }, { status: 400 })
  }

  let draft: Buffer | null = null
  let sentTo: string[] = []
  if (mode === 'email' || mode === 'outlook') {
    // One email to the main address and every extra contact.
    const { emails, greeting } = await contractorRecipients(supabase, contractor)
    if (emails.length === 0) {
      return Response.json({ error: 'Contractor has no email address on file' }, { status: 400 })
    }
    sentTo = emails
    if (mode === 'email' && !isEmailConfigured()) {
      return Response.json({ error: 'Email sending is not configured (set SMTP_HOST on the server)' }, { status: 500 })
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
    const { subject, html, text } = contractorNewItemsEmail({
      // The sender is the contractor's contact for these items.
      sender: { name: profile.full_name ?? null, email: user.email ?? profile.email ?? null, phone: profile.phone ?? null },
      contractorName: contractor.company_name,
      contactName: greeting,
      portalUrl: `${appUrl}/portal/${contractor.portal_token}`,
      message,
      items: items.map(i => ({
        itemNumber: i.item_number,
        title: i.title,
        unitIdentifier: i.unit?.unit_identifier ?? null,
        address: i.unit?.address ?? null,
        projectName: i.unit?.project?.name ?? null,
        owners: i.unit?.owners ?? [],
      })),
    })

    // Replies go to whoever clicked Notify; EMAIL_REPLY_TO is a fallback for users without an email.
    // They're also CC'd so they have a copy of what was sent.
    if (mode === 'outlook') {
      // Sent from the user's own Outlook, so it's in their Sent Items; no CC needed.
      draft = await buildOutlookDraft({ to: emails, subject, html, text })
    } else {
      const replyTo = user.email ?? process.env.EMAIL_REPLY_TO
      // Skip the CC if the sender is already one of the recipients.
      const cc = user.email && !emails.some(e => e.toLowerCase() === user.email!.toLowerCase()) ? user.email : null
      const { error: emailError } = await sendEmail({ to: emails.join(', '), cc, replyTo, subject, html, text })
      if (emailError) return Response.json({ error: emailError }, { status: 500 })
    }
  }

  const now = new Date().toISOString()
  const ids = items.map(i => i.id)

  // Generating an Outlook draft counts as notifying: the user sends it straight away
  // from Outlook, and the items come off their "new" list like a sent email would.
  const { error: stampErr } = await supabase
    .from('maintenance_items')
    .update({ contractor_notified_at: now })
    .in('id', ids)
  if (stampErr) {
    // The email (if any) already went out; report so the user knows the badge may be stale.
    return Response.json({ error: `Notified, but failed to record it: ${stampErr.message}`, sent: mode === 'email' }, { status: 500 })
  }

  const onBehalf = new Set(items.filter(i => i.responsible_id !== user.id).map(i => i.id))
  await supabase.from('activity_log').insert(ids.map(itemId => ({
    maintenance_item_id: itemId,
    action: 'contractor_notified',
    details: {
      contractor_id: contractor.id,
      contractor: contractor.company_name,
      method: mode === 'mark' ? 'manual' : mode,
      ...(mode !== 'mark' ? { to: sentTo.join(', ') } : {}),
      ...(mode !== 'mark' && message ? { message } : {}),
      ...(onBehalf.has(itemId) ? { on_behalf: true } : {}),
    },
    performed_by: user.email ?? 'admin',
  })))

  if (draft) {
    return new Response(new Uint8Array(draft), {
      headers: {
        'Content-Type': 'message/rfc822',
        'Content-Disposition': attachmentDisposition(`Notify ${contractor.company_name.trim()}.eml`),
        'Cache-Control': 'no-store',
        // The items that were stamped, for the dialog (the body is the .eml).
        'X-Item-Ids': ids.join(','),
      },
    })
  }

  return Response.json({ success: true, count: ids.length, mode, item_ids: ids, to: sentTo })
}
