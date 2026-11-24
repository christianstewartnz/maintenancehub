/** Input checks shared by the admin API routes. */

import type { UserRole } from '@/lib/types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// Digits, spaces and the usual phone punctuation; it's shown to contractors as-is.
const PHONE_RE = /^[0-9+()\-.\s]{3,40}$/

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}

export function isRole(v: unknown): v is UserRole {
  return v === 'admin' || v === 'staff'
}

/** Normalised email, or null if it doesn't look like one. */
export function cleanEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const e = v.trim().toLowerCase()
  return e.length <= 254 && EMAIL_RE.test(e) ? e : null
}

/** undefined = not given; null = cleared; string = new value; Error = invalid. */
export function cleanName(v: unknown): string | null | undefined | Error {
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v !== 'string') return new Error('Name must be text')
  const s = v.trim()
  if (s.length > 100) return new Error('Name is too long (100 characters max)')
  return s || null
}

export function cleanPhone(v: unknown): string | null | undefined | Error {
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v !== 'string') return new Error('Phone must be text')
  const s = v.trim().replace(/\s+/g, ' ')
  if (!s) return null
  if (!PHONE_RE.test(s)) return new Error('Phone number can only contain digits, spaces and + ( ) - .')
  return s
}

export function bad(message: string, status = 400) {
  return Response.json({ error: message }, { status })
}

export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json()
    return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null
  } catch {
    return null
  }
}
