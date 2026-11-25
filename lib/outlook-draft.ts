import MailComposer from 'nodemailer/lib/mail-composer'

/**
 * Builds an unsent email as a raw .eml file. "X-Unsent: 1" makes desktop Outlook open
 * it as a new message ready to edit and send. There's no From, so Outlook sends it from
 * the account it's opened in. Used when the app's own email sending is unavailable.
 */
export async function buildOutlookDraft(opts: {
  to: string[]
  cc?: string[]
  subject: string
  html: string
  text?: string
}): Promise<Buffer> {
  const composer = new MailComposer({
    to: opts.to.join(', '),
    cc: opts.cc?.length ? opts.cc.join(', ') : undefined,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
    headers: { 'X-Unsent': '1' },
  })
  return composer.compile().build()
}

/** Content-Disposition for a downloaded file, safe for non-ASCII names. */
export function attachmentDisposition(filename: string) {
  const clean = filename.replace(/[\\/:*?"<>|]+/g, '-')
  return `attachment; filename="${clean.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(clean)}`
}
