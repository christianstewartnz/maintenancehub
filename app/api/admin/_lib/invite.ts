import type { SupabaseClient, User } from '@supabase/supabase-js'
import { sendEmail, SENDER_NAME } from '@/lib/mailer'

/**
 * Set-password links for invited users (and re-sends / resets).
 *
 * We don't use Supabase's built-in invite email. Its link goes through
 * /auth/v1/verify and comes back with the session in the URL #hash (implicit
 * flow), which the PKCE browser client from @supabase/ssr won't pick up, and it
 * depends on the Auth redirect allow-list. Instead we generate the link's
 * token_hash with auth.admin.generateLink (which sends nothing) and email our own
 * link straight to /auth/accept-invite. That page only redeems the token when the
 * user submits their new password, so mail scanners that pre-open links (Outlook
 * Safe Links) can't use it up.
 */

export type LinkType = 'invite' | 'recovery'

/**
 * The site the admin is using, so the link matches it (live → live, local dev → local).
 * NEXT_PUBLIC_APP_URL is only a fallback: it's localhost in .env.local.
 */
function appBase(req: Request) {
  try {
    return new URL(req.url).origin
  } catch {
    return process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, '') || 'http://localhost:3000'
  }
}

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Creates (type 'invite', for a new email) or refreshes a user's set-password link.
 * An invite for a new email also creates the auth user (and, via trigger, the profile).
 */
export async function generateSetPasswordLink(
  service: SupabaseClient,
  req: Request,
  type: LinkType,
  email: string,
  fullName?: string | null,
): Promise<{ link: string; user: User } | { error: string }> {
  const { data, error } = type === 'invite'
    ? await service.auth.admin.generateLink({ type: 'invite', email, options: { data: fullName ? { full_name: fullName } : undefined } })
    : await service.auth.admin.generateLink({ type: 'recovery', email })
  if (error || !data?.properties?.hashed_token || !data.user) return { error: error?.message ?? 'Could not create the link' }

  const url = new URL('/auth/accept-invite', appBase(req))
  url.searchParams.set('token_hash', data.properties.hashed_token)
  url.searchParams.set('type', type)
  return { link: url.toString(), user: data.user }
}

/** Emails the set-password link. Never throws. */
export async function emailSetPasswordLink(opts: {
  to: string
  name: string | null
  link: string
  invitedBy: string | null
  isNew: boolean
}): Promise<{ error: string | null }> {
  const first = opts.name?.trim().split(/\s+/)[0] ?? ''
  const hiText = first ? `Hi ${first},` : 'Hi,'
  const hi = esc(hiText)
  const intro = opts.isNew
    ? (opts.invitedBy ? `${esc(opts.invitedBy)} has invited you to ${SENDER_NAME}.` : `You have been invited to ${SENDER_NAME}.`)
    : `Here is a link to set a new password for ${SENDER_NAME}.`
  const subject = opts.isNew ? `You're invited to ${SENDER_NAME}` : `Set your ${SENDER_NAME} password`
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;color:#37352f;line-height:1.5">
<p>${hi}</p>
<p>${intro}</p>
<p>Click the button below to choose your password. You'll be signed in straight after.</p>
<p><a href="${esc(opts.link)}" style="display:inline-block;background:#2383e2;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600">Set my password</a></p>
<p style="font-size:13px;color:#787774">Your sign-in email is <strong>${esc(opts.to)}</strong>. The link can only be used once and expires after a while; if it has expired, ask your admin to send a new one.</p>
<p style="font-size:13px;color:#787774">If the button doesn't work, copy this address into your browser:<br>${esc(opts.link)}</p>
</div>`
  const text = `${hiText}\n\n${opts.isNew ? 'You have been invited to ' + SENDER_NAME + '.' : 'Set a new password for ' + SENDER_NAME + '.'}\n\nChoose your password here (the link can only be used once):\n${opts.link}\n\nYour sign-in email is ${opts.to}.`
  return sendEmail({ to: opts.to, subject, html, text })
}
