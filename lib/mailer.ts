import nodemailer, { type Transporter } from 'nodemailer'
import { Resend } from 'resend'

/**
 * Single place the app sends email from.
 *
 * Uses SMTP when SMTP_HOST is set (SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS,
 * SMTP_FROM), otherwise falls back to Resend (RESEND_API_KEY, RESEND_FROM_EMAIL).
 * The display name is always "Stratum Maintenance Hub".
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
  return smtpEnabled() || !!env('RESEND_API_KEY')
}

/** Strip any "Name <addr>" wrapper so we can apply our own display name. */
function bareAddress(value: string) {
  return value.match(/<([^>]+)>/)?.[1] ?? value.trim()
}

function fromHeader() {
  const configured = (smtpEnabled() ? env('SMTP_FROM') ?? env('SMTP_USER') : env('RESEND_FROM_EMAIL'))
    ?? 'noreply@maintenancehub.co.nz'
  return `${SENDER_NAME} <${bareAddress(configured)}>`
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
    mode: smtpEnabled() ? 'smtp' : env('RESEND_API_KEY') ? 'resend' : 'none',
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

/** Sends an email. Never throws; returns { error } on failure. */
export async function sendEmail(opts: SendEmailOptions): Promise<{ error: string | null }> {
  if (!isEmailConfigured()) {
    return { error: 'Email sending is not configured (set SMTP_HOST or RESEND_API_KEY)' }
  }
  if (smtpEnabled() && !env('SMTP_USER')) {
    return { error: 'SMTP login missing: SMTP_USER is not set on the server' }
  }
  const from = fromHeader()
  const replyTo = opts.replyTo || undefined

  try {
    if (smtpEnabled()) {
      await getTransporter().sendMail({
        from,
        to: opts.to,
        replyTo,
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
        attachments: opts.attachments,
      })
      return { error: null }
    }

    const resend = new Resend(process.env.RESEND_API_KEY)
    const { error } = await resend.emails.send({
      from,
      to: opts.to,
      ...(replyTo ? { replyTo } : {}),
      subject: opts.subject,
      html: opts.html,
      ...(opts.text ? { text: opts.text } : {}),
      ...(opts.attachments ? { attachments: opts.attachments.map(a => ({ filename: a.filename, content: a.content })) } : {}),
    })
    return { error: error?.message ?? null }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to send email' }
  }
}
