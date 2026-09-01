import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { maintenanceDueEmail } from '@/lib/email-templates'

// Called daily by Vercel cron: POST /api/maintenance-due/send
// Sends an alert email when units have their 90-day maintenance form due within 14 days or overdue.
export async function POST(req: Request) {
  const auth = req.headers.get('authorization')
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!process.env.RESEND_API_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ error: 'Missing RESEND_API_KEY or SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })
  }

  const serviceSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // Fetch all units with a settlement date, joined to project name
  const { data: units, error } = await serviceSupabase
    .from('units')
    .select('id, unit_identifier, settlement_date, project:projects(name)')
    .not('settlement_date', 'is', null)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!units?.length) return Response.json({ sent: false, reason: 'no units with settlement dates' })

  const now = Date.now()
  const fourteenDays = 14 * 24 * 60 * 60 * 1000

  type UnitRow = { unitIdentifier: string; projectName: string; settlementDate: string; dueDate: string; daysUntilDue: number }
  type OverdueRow = { unitIdentifier: string; projectName: string; settlementDate: string; dueDate: string; daysOverdue: number }

  const upcomingUnits: UnitRow[] = []
  const overdueUnits: OverdueRow[] = []

  for (const u of units) {
    const settlement = u.settlement_date as string
    const due = new Date(settlement)
    due.setDate(due.getDate() + 90)
    const msUntilDue = due.getTime() - now
    const daysUntilDue = Math.ceil(msUntilDue / 86400000)
    const project = u.project as any
    const projectName = project?.name ?? '—'
    const dueDateStr = due.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
    const settlementStr = new Date(settlement).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })

    if (daysUntilDue < 0) {
      overdueUnits.push({ unitIdentifier: u.unit_identifier, projectName, settlementDate: settlementStr, dueDate: dueDateStr, daysOverdue: Math.abs(daysUntilDue) })
    } else if (msUntilDue <= fourteenDays) {
      upcomingUnits.push({ unitIdentifier: u.unit_identifier, projectName, settlementDate: settlementStr, dueDate: dueDateStr, daysUntilDue })
    }
  }

  if (upcomingUnits.length === 0 && overdueUnits.length === 0) {
    return Response.json({ sent: false, reason: 'nothing due within 14 days' })
  }

  // Sort upcoming by days ascending, overdue by days overdue descending
  upcomingUnits.sort((a, b) => a.daysUntilDue - b.daysUntilDue)
  overdueUnits.sort((a, b) => b.daysOverdue - a.daysOverdue)

  // Find the admin email — use the first user with notification preferences, or fall back to any user
  let adminEmail: string | undefined
  const { data: prefRows } = await serviceSupabase
    .from('notification_preferences')
    .select('user_id')
    .limit(1)

  if (prefRows?.length) {
    const { data: { user } } = await serviceSupabase.auth.admin.getUserById(prefRows[0].user_id)
    adminEmail = user?.email
  }

  if (!adminEmail) {
    const { data: { users } } = await serviceSupabase.auth.admin.listUsers({ perPage: 1 })
    adminEmail = users?.[0]?.email
  }

  if (!adminEmail) return Response.json({ error: 'Could not determine admin email' }, { status: 500 })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const resend = new Resend(process.env.RESEND_API_KEY)
  const from = process.env.RESEND_FROM_EMAIL ?? 'Maintenance Hub <noreply@maintenancehub.co.nz>'

  const { subject, html } = maintenanceDueEmail({ upcomingUnits, overdueUnits, appUrl })
  await resend.emails.send({ from, to: adminEmail, subject, html })

  return Response.json({ sent: true, upcoming: upcomingUnits.length, overdue: overdueUnits.length })
}
