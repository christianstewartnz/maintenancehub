import { createClient } from '@supabase/supabase-js'
import { sendEmail, isEmailConfigured } from '@/lib/mailer'
import { maintenanceDueEmail } from '@/lib/email-templates'
import { formatUnitLabel } from '@/lib/utils'
import { getRecipients } from '@/lib/notify-recipients'

// Called weekly by Vercel cron (Sunday 19:00 UTC = Monday morning NZ): POST /api/maintenance-due/send
// Sends an alert email when units have their 90-day maintenance form due within 14 days,
// or overdue by no more than 7 days — older overdue units drop off the email.
export async function POST(req: Request) {
  const auth = req.headers.get('authorization')
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isEmailConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ error: 'Missing email settings (SMTP_HOST) or SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })
  }

  const serviceSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // Fetch all units with a settlement date, joined to project name
  const { data: units, error } = await serviceSupabase
    .from('units')
    .select('id, unit_identifier, address, settlement_date, project:projects(name)')
    .not('settlement_date', 'is', null)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!units?.length) return Response.json({ sent: false, reason: 'no units with settlement dates' })

  const now = Date.now()
  const fourteenDays = 14 * 24 * 60 * 60 * 1000
  const maxDaysOverdue = 7

  type UnitRow = { unitLabel: string; projectName: string; settlementDate: string; dueDate: string; daysUntilDue: number }
  type OverdueRow = { unitLabel: string; projectName: string; settlementDate: string; dueDate: string; daysOverdue: number }

  const upcomingUnits: UnitRow[] = []
  const overdueUnits: OverdueRow[] = []

  for (const u of units) {
    const settlement = u.settlement_date as string
    const due = new Date(settlement)
    due.setDate(due.getDate() + 90)
    const msUntilDue = due.getTime() - now
    const daysUntilDue = Math.ceil(msUntilDue / 86400000)
    const project = u.project as any
    const unitLabel = formatUnitLabel(u)
    const projectName = project?.name ?? '—'
    const dueDateStr = due.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
    const settlementStr = new Date(settlement).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })

    if (daysUntilDue < 0) {
      if (-daysUntilDue > maxDaysOverdue) continue
      overdueUnits.push({ unitLabel, projectName, settlementDate: settlementStr, dueDate: dueDateStr, daysOverdue: Math.abs(daysUntilDue) })
    } else if (msUntilDue <= fourteenDays) {
      upcomingUnits.push({ unitLabel, projectName, settlementDate: settlementStr, dueDate: dueDateStr, daysUntilDue })
    }
  }

  if (upcomingUnits.length === 0 && overdueUnits.length === 0) {
    return Response.json({ sent: false, reason: 'nothing due within 14 days or overdue within the last 7 days' })
  }

  // Sort upcoming by days ascending, overdue by days overdue descending
  upcomingUnits.sort((a, b) => a.daysUntilDue - b.daysUntilDue)
  overdueUnits.sort((a, b) => b.daysOverdue - a.daysOverdue)

  // Every user who has the maintenance-due alert switched on.
  const recipients = await getRecipients(serviceSupabase, 'maintenance_due_email')
  if (!recipients.length) return Response.json({ sent: false, reason: 'no users have the maintenance-due alert switched on' })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  const { subject, html } = maintenanceDueEmail({ upcomingUnits, overdueUnits, appUrl })
  const results = await Promise.all(recipients.map(r => sendEmail({ to: r.email, subject, html })))

  return Response.json({ sent: results.filter(r => !r.error).length, upcoming: upcomingUnits.length, overdue: overdueUnits.length })
}

// Vercel Cron invokes routes with GET
export { POST as GET }
