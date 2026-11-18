import nodemailer, { type Transporter } from 'nodemailer'
import { format } from 'node:util'

/**
 * Single place the app sends email from.
 *
 * Sends through the SMTP server only (SMTP_HOST, SMTP_PORT, SMTP_SECURE,
 * SMTP_USER, SMTP_PASS, SMTP_FROM). The display name is always
 * "Stratum Maintenance Hub".
 */

export const SENDER_NAME = 'Stratum Maintenance Hub'

export interface EmailAttachment {
  filename: string
  content: Buffer
  contentType?: string
}

export interface SendEmailOptions {
  to: string
  subject: string
  html: string
  text?: string
  replyTo?: string | null
  cc?: string | null
  attachments?: EmailAttachment[]
}

/** Reads an env var, ignoring stray whitespace or wrapping quotes pasted into the dashboard. */
function env(name: string): string | undefined {
  const v = process.env[name]?.trim().replace(/^(['"])(.*)\1$/, '$2').trim()
  return v ? v : undefined
}

function smtpEnabled() {
  return !!env('SMTP_HOST')
}

export function isEmailConfigured() {
  return smtpEnabled()
}

/** Message shown when SMTP isn't set up on the server. */
export const EMAIL_NOT_CONFIGURED = 'Email sending is not configured (set SMTP_HOST on the server)'

/** The SMTP mailbox emails are sent from, or null if SMTP isn't set up. */
export function senderAddress(): string | null {
  if (!smtpEnabled()) return null
  const v = env('SMTP_FROM') ?? env('SMTP_USER')
  return v ? bareAddress(v) : null
}

/** Strip any "Name <addr>" wrapper so we can apply our own display name. */
function bareAddress(value: string) {
  return value.match(/<([^>]+)>/)?.[1] ?? value.trim()
}

function fromHeader() {
  const configured = env('SMTP_FROM') ?? env('SMTP_USER') ?? 'noreply@maintenancehub.co.nz'
  return `${SENDER_NAME} <${bareAddress(configured)}>`
}

function appHostname(): string | undefined {
  try {
    const url = env('NEXT_PUBLIC_APP_URL')
    const host = url ? new URL(url).hostname : undefined
    return host && host !== 'localhost' ? host : undefined
  } catch {
    return undefined
  }
}

function smtpConfig() {
  const port = Number(env('SMTP_PORT') ?? 465)
  const secureVar = env('SMTP_SECURE')
  return {
    host: env('SMTP_HOST'),
    port,
    // 465 = implicit SSL/TLS; 587 = STARTTLS. SMTP_SECURE overrides.
    secure: secureVar ? secureVar.toLowerCase() === 'true' : port === 465,
    user: env('SMTP_USER'),
    pass: env('SMTP_PASS'),
    // Name the app gives in its SMTP greeting. Serverless hosts otherwise send a
    // random internal machine name, which some mail servers distrust.
    heloName: env('SMTP_HELO_NAME') ?? appHostname(),
  }
}

let transporter: Transporter | null = null
function getTransporter() {
  if (!transporter) {
    const c = smtpConfig()
    transporter = nodemailer.createTransport({
      host: c.host,
      port: c.port,
      secure: c.secure,
      name: c.heloName,
      auth: c.user ? { user: c.user, pass: c.pass ?? '' } : undefined,
    })
  }
  return transporter
}

/**
 * Reports what the server can see of the SMTP settings (never the password)
 * and whether it can log in. Used by /api/email/diagnose.
 */
export async function diagnoseSmtp() {
  const c = smtpConfig()
  const info = {
    mode: smtpEnabled() ? 'smtp' : 'none',
    host: c.host ?? null,
    port: c.port,
    secure: c.secure,
    user: c.user ?? null,
    passwordSet: !!c.pass,
    passwordLength: c.pass?.length ?? 0,
    from: fromHeader(),
    rawLengths: Object.fromEntries(
      ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM']
        .map(k => [k, process.env[k]?.length ?? null]),
    ),
    region: process.env.VERCEL_REGION ?? null,
    login: 'not tried' as string,
  }
  if (info.mode === 'smtp') {
    try {
      await getTransporter().verify()
      info.login = c.user ? 'ok' : 'connected, but no SMTP_USER so it did not log in'
    } catch (e) {
      info.login = `failed: ${e instanceof Error ? e.message : String(e)}`
    }
  }
  return info
}

/**
 * Sends one plain test email over SMTP and returns the full conversation with
 * the mail server, with credentials removed, so it can be handed to the provider.
 */
export async function smtpTestSend(to: string) {
  const c = smtpConfig()
  const log: string[] = []
  const secrets = [c.pass, c.pass && Buffer.from(c.pass).toString('base64'),
    c.user && c.pass && Buffer.from(`\u0000${c.user}\u0000${c.pass}`).toString('base64')]
    .filter((s): s is string => !!s)
  const scrub = (s: string) => secrets.reduce((acc, sec) => acc.split(sec).join('[hidden]'), s)
  const write = (level: string) => (_entry: unknown, message: string, ...args: unknown[]) => {
    log.push(`${level} ${scrub(format(message, ...args))}`)
  }
  const logger = {
    level: () => {}, trace: write('trace'), debug: write('debug'), info: write('info'),
    warn: write('warn'), error: write('error'), fatal: write('fatal'),
  }

  const t = nodemailer.createTransport({
    host: c.host, port: c.port, secure: c.secure, name: c.heloName,
    auth: c.user ? { user: c.user, pass: c.pass ?? '' } : undefined,
    logger, debug: true,
  })

  let result: string
  try {
    const r = await t.sendMail({
      from: fromHeader(),
      to,
      subject: `${SENDER_NAME}: SMTP test from live server`,
      text: `Test email sent from the live server (region ${process.env.VERCEL_REGION ?? 'unknown'}).`,
    })
    result = `sent: ${r.response}`
  } catch (e) {
    result = `failed: ${e instanceof Error ? e.message : String(e)}`
  } finally {
    t.close()
  }

  let publicIp: string | null = null
  try {
    publicIp = (await (await fetch('https://api.ipify.org', { cache: 'no-store' })).text()).trim()
  } catch { /* not essential */ }

  return { to, region: process.env.VERCEL_REGION ?? null, publicIp, result, log }
}

/** Sends an email. Never throws; returns { error } on failure. */
export async function sendEmail(opts: SendEmailOptions): Promise<{ error: string | null }> {
  if (!isEmailConfigured()) {
    return { error: EMAIL_NOT_CONFIGURED }
  }
  if (!env('SMTP_USER')) {
    return { error: 'SMTP login missing: SMTP_USER is not set on the server' }
  }
  const from = fromHeader()
  const replyTo = opts.replyTo || undefined

  try {
    await getTransporter().sendMail({
      from,
      to: opts.to,
      // Skip a CC that just repeats the recipient.
      cc: opts.cc && opts.cc.toLowerCase() !== opts.to.toLowerCase() ? opts.cc : undefined,
      replyTo,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
      attachments: opts.attachments,
    })
    return { error: null }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to send email' }
  }
}
