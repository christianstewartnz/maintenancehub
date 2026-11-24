import { createClient } from '@supabase/supabase-js'
import { sendEmail, isEmailConfigured } from '@/lib/mailer'
import { maintenanceDueEmail } from '@/lib/email-templates'
import { formatUnitLabel } from '@/lib/utils'
import { getRecipients } from '@/lib/notify-recipients'
import { canSeeProject, projectAccessByUser } from '@/app/api/admin/_lib/recipient-access'

// Called weekly by Vercel cron (Sunday 19:00 UTC = Monday morning NZ): POST /api/maintenance-due/send
// Sends an alert email when units have their 90-day maintenance form due within 28 days,
// or overdue by no more than 7 days — older overdue units drop off the email.
// Each unit has a "Draft email" link that downloads the owner reminder as an Outlook .eml.
// Each recipient only gets units on projects they can access: admins all, staff their
// assigned projects, deactivated users nothing (the service client bypasses RLS).
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
    .select('id, unit_identifier, address, settlement_date, maintenance_reminder_sent_at, project_id, project:projects(name), owners:unit_owners(email)')
    .not('settlement_date', 'is', null)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!units?.length) return Response.json({ sent: false, reason: 'no units with settlement dates' })

  const now = Date.now()
  const upcomingWindow = 28 * 24 * 60 * 60 * 1000
  const maxDaysOverdue = 7

  type UnitRow = { projectId: string; unitId: string; hasOwnerEmail: boolean; unitLabel: string; projectName: string; settlementDate: string; dueDate: string; daysUntilDue: number }
  type OverdueRow = { projectId: string; unitId: string; hasOwnerEmail: boolean; unitLabel: string; projectName: string; settlementDate: string; dueDate: string; daysOverdue: number }

  const upcomingUnits: UnitRow[] = []
  const overdueUnits: OverdueRow[] = []

  for (const u of units) {
    // Owners already reminded — nothing more for us to do on this unit.
    if (u.maintenance_reminder_sent_at) continue
    const settlement = u.settlement_date as string
    const due = new Date(settlement)
    due.setDate(due.getDate() + 90)
    const msUntilDue = due.getTime() - now
    const daysUntilDue = Math.ceil(msUntilDue / 86400000)
    const project = u.project as unknown as { name: string } | null
    const unitLabel = formatUnitLabel(u)
    const projectName = project?.name ?? '—'
    const dueDateStr = due.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
    const unitId = u.id as string
    const projectId = u.project_id as string
    const hasOwnerEmail = ((u.owners ?? []) as { email: string | null }[]).some(o => o.email?.includes('@'))
    const settlementStr = new Date(settlement).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })

    if (daysUntilDue < 0) {
      if (-daysUntilDue > maxDaysOverdue) continue
      overdueUnits.push({ projectId, unitId, hasOwnerEmail, unitLabel, projectName, settlementDate: settlementStr, dueDate: dueDateStr, daysOverdue: Math.abs(daysUntilDue) })
    } else if (msUntilDue <= upcomingWindow) {
      upcomingUnits.push({ projectId, unitId, hasOwnerEmail, unitLabel, projectName, settlementDate: settlementStr, dueDate: dueDateStr, daysUntilDue })
    }
  }

  if (upcomingUnits.length === 0 && overdueUnits.length === 0) {
    return Response.json({ sent: false, reason: 'nothing due within 28 days or overdue within the last 7 days' })
  }

  // Sort upcoming by days ascending, overdue by days overdue descending
  upcomingUnits.sort((a, b) => a.daysUntilDue - b.daysUntilDue)
  overdueUnits.sort((a, b) => b.daysOverdue - a.daysOverdue)

  // Every user who has the maintenance-due alert switched on.
  const recipients = await getRecipients(serviceSupabase, 'maintenance_due_email')
  if (!recipients.length) return Response.json({ sent: false, reason: 'no users have the maintenance-due alert switched on' })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  const access = await projectAccessByUser(serviceSupabase, recipients.map(r => r.userId))
  const results = await Promise.all(recipients.map(r => {
    const a = access.get(r.userId)
    const upcoming = upcomingUnits.filter(u => canSeeProject(a, u.projectId))
    const overdue = overdueUnits.filter(u => canSeeProject(a, u.projectId))
    // Nothing on their projects this week (or they're deactivated): no email.
    if (!upcoming.length && !overdue.length) return null
    const { subject, html } = maintenanceDueEmail({ upcomingUnits: upcoming, overdueUnits: overdue, appUrl })
    return sendEmail({ to: r.email, subject, html })
  }))

  return Response.json({
    sent: results.filter(r => r && !r.error).length,
    skipped: results.filter(r => !r).length,
    upcoming: upcomingUnits.length,
    overdue: overdueUnits.length,
  })
}

// Vercel Cron invokes routes with GET
export { POST as GET }
