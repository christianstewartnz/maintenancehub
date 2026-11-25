import type { createClient } from '@/lib/supabase/server'

type Client = Awaited<ReturnType<typeof createClient>>

/**
 * Everyone an email to a contractor goes to: the contractor's main email plus each
 * extra contact's email (contractor_contacts), deduplicated, in one email. `greeting`
 * is their first names ("Dave and Sam"), or null if none are known.
 */
export async function contractorRecipients(
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
