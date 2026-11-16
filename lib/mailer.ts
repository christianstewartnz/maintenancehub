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

function smtpEnabled() {
  return !!process.env.SMTP_HOST
}

export function isEmailConfigured() {
  return smtpEnabled() || !!process.env.RESEND_API_KEY
}

/** Strip any "Name <addr>" wrapper so we can apply our own display name. */
function bareAddress(value: string) {
  return value.match(/<([^>]+)>/)?.[1] ?? value.trim()
}

function fromHeader() {
  const configured = (smtpEnabled() ? process.env.SMTP_FROM ?? process.env.SMTP_USER : process.env.RESEND_FROM_EMAIL)
    ?? 'noreply@maintenancehub.co.nz'
  return `${SENDER_NAME} <${bareAddress(configured)}>`
}

let transporter: Transporter | null = null
function getTransporter() {
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT ?? 465)
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      // 465 = implicit SSL/TLS; 587 = STARTTLS. SMTP_SECURE overrides.
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' } : undefined,
    })
  }
  return transporter
}

/** Sends an email. Never throws; returns { error } on failure. */
export async function sendEmail(opts: SendEmailOptions): Promise<{ error: string | null }> {
  if (!isEmailConfigured()) {
    return { error: 'Email sending is not configured (set SMTP_HOST or RESEND_API_KEY)' }
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
