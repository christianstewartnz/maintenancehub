/**
 * The 90-day maintenance reminder sent to unit owners, built as an Outlook-ready .eml
 * ("X-Unsent: 1" makes desktop Outlook open it as a new message to edit and send).
 * Wording follows the reminder emails Christian sends by hand.
 */

import MailComposer from 'nodemailer/lib/mail-composer'

export interface ReminderOwner { name: string | null; email: string | null }
export interface ReminderAttachment { filename: string; content: Buffer; contentType?: string }

/** 90 days after settlement: the last day owners can submit their form. */
export function maintenanceDueDate(settlementDate: string): Date {
  const due = new Date(`${settlementDate.slice(0, 10)}T00:00:00Z`)
  due.setUTCDate(due.getUTCDate() + 90)
  return due
}

/** "John and Karen", "Ann, Bob and Cat"; null when no owner has a name. */
export function ownerGreetingNames(owners: ReminderOwner[]): string | null {
  const firsts = owners
    .map(o => o.name?.trim().split(/\s+/)[0]?.replace(/[^\p{L}'-]/gu, ''))
    .filter((n): n is string => !!n)
  const unique = [...new Set(firsts)]
  if (unique.length === 0) return null
  if (unique.length === 1) return unique[0]
  return `${unique.slice(0, -1).join(', ')} and ${unique[unique.length - 1]}`
}

/** Owner emails, splitting cells that hold several addresses. */
export function ownerEmails(owners: ReminderOwner[]): string[] {
  const all = owners.flatMap(o => (o.email ?? '').split(/[;,\s]+/)).map(e => e.trim()).filter(e => e.includes('@'))
  return [...new Set(all.map(e => e.toLowerCase()))].map(lower => all.find(e => e.toLowerCase() === lower)!)
}

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function ownerReminderEmail(opts: {
  owners: ReminderOwner[]
  projectName: string
  dueDate: Date
  now?: Date
}): { to: string[]; subject: string; html: string } {
  const now = opts.now ?? new Date()
  const nzHour = Number(new Intl.DateTimeFormat('en-NZ', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Pacific/Auckland' }).format(now))
  const greeting = `Good ${nzHour < 12 ? 'morning' : 'afternoon'}`
  const names = ownerGreetingNames(opts.owners)
  // "Wednesday 9 December 2026" (no comma, as in the hand-written reminders)
  const part = (o: Intl.DateTimeFormatOptions) => opts.dueDate.toLocaleDateString('en-NZ', { ...o, timeZone: 'UTC' })
  const deadline = `${part({ weekday: 'long' })} ${part({ day: 'numeric' })} ${part({ month: 'long' })} ${part({ year: 'numeric' })}`
  const project = esc(opts.projectName)

  const p = (html: string) => `<p style="margin: 0 0 12px;">${html}</p>`
  const html = `<div style="font-family: Calibri, Arial, sans-serif; font-size: 11pt; color: #000;">
${p(`${greeting}${names ? ` ${esc(names)}` : ''}`)}
${p('I hope this email finds you well.')}
${p(`I don’t know about you but I can’t believe that it has almost now been 90 days since you settled on your ${project} unit!`)}
${p('I hope you are making good progress in turning your new house into a home or have found yourself some great tenants if you are letting your unit.')}
${p('As we are fast approaching the 90 day mark from when your unit settled I thought I should send a reminder about the maintenance period form that you were advised about on the day of your settlement.')}
${p(`If you haven’t yet compiled and submitted your full and final maintenance/snagging list please do so and submit it no later than <b>4pm on ${esc(deadline)}.</b>`)}
${p('We only allow for one form to be submitted for each unit so please only send this once you are certain you have everything. Please note this email has only been sent to owners, not to any property managers or tenants, so please liaise with them (if applicable) to compile the list of maintenance items, for your one list for your unit.')}
${p('Attached is a copy of the maintenance form in case you cannot find the versions already provided.')}
${p('A reminder to please return your form in digital copy (i.e. in a word format) as this makes processing much easier.')}
${p('Once we have your list and we have passed 90 days, the forms will be reviewed &amp; processed, then the relevant trades will be organised to come through and make good any items cited in as little a period of time so to cause as little inconvenience/disturbance to you as possible.')}
${p('If you have any questions about the process of maintenance please don’t hesitate to contact me.')}
<p style="margin: 24px 0 0;"><b>Regards</b></p>
<p style="margin: 12px 0 0;"><b>Christian Stewart</b></p>
<p style="margin: 24px 0 0;"><b>STRATUM MANAGEMENT LTD</b><br>PO Box 11 680<br>Manners Street<br>Wellington<br>Telephone 027 542 1192<br><a href="https://www.stratummanagement.co.nz/">https://www.stratummanagement.co.nz/</a></p>
</div>`

  return { to: ownerEmails(opts.owners), subject: `${opts.projectName} - Maintenance reminder`, html }
}

/** Builds the raw .eml (an unsent draft). No From, so Outlook uses the account it's opened in. */
export async function buildDraftEml(opts: { to: string[]; subject: string; html: string; attachments: ReminderAttachment[] }): Promise<Buffer> {
  const composer = new MailComposer({
    to: opts.to.join(', '),
    subject: opts.subject,
    html: opts.html,
    headers: { 'X-Unsent': '1' },
    attachments: opts.attachments.map(a => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
  })
  return composer.compile().build()
}
