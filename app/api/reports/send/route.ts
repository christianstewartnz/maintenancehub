import { createClient } from '@supabase/supabase-js'
import { sendEmail, isEmailConfigured } from '@/lib/mailer'
import { reportEmail } from '@/lib/email-templates'
import { formatUnitLabel } from '@/lib/utils'
import { resolve } from '@/lib/notify-recipients'
import { canSeeProject, projectAccessByUser } from '@/app/api/admin/_lib/recipient-access'

// Called daily by Vercel cron (or manually): POST /api/reports/send
// Daily-report users get one every run; weekly-report users only on the Sunday-UTC run (Monday morning NZ).
// Pass ?all=1 to send to weekly users on any day.
// Each recipient only gets projects they can access: admins all, staff their assigned
// projects, deactivated users nothing (this runs on the service client, which bypasses RLS).
// Requires Bearer token matching CRON_SECRET env var
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

  // Find all users with a report preference (not 'none')
  const { data: prefRows } = await serviceSupabase
    .from('notification_preferences')
    .select('*')
    .neq('report_frequency', 'none')

  const now = new Date()
  const weeklyDay = now.getUTCDay() === 0 || new URL(req.url).searchParams.get('all') === '1'
  const due = (prefRows ?? []).filter(p => p.report_frequency === 'daily' || weeklyDay)
  if (!due.length) return Response.json({ sent: 0 })
  const access = await projectAccessByUser(serviceSupabase, due.map(p => p.user_id))
  const recipients = await resolve(serviceSupabase, due.filter(p => access.has(p.user_id)))
  if (!recipients.length) return Response.json({ sent: 0 })

  // Every live item once (paged past PostgREST's row cap), then filtered per recipient below.
  type ItemRow = { id: string; item_number: string; title: string; status: string; created_at: string; completed_at: string | null; unit: { unit_identifier: string | null; address: string | null; project_id: string; project: { id: string; name: string } | null } | null }
  const allItems: ItemRow[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await serviceSupabase
      .from('maintenance_items')
      .select('id, item_number, title, status, created_at, completed_at, unit:units(unit_identifier, address, project_id, project:projects(id, name))')
      .is('archived_at', null)
      .eq('has_steps', false) // a job split into steps is counted through its steps
      .order('id')
      .range(from, from + 999)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    allItems.push(...((data ?? []) as unknown as ItemRow[]))
    if (!data || data.length < 1000) break
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  let sent = 0

  for (const { userId, email, prefs } of recipients) {
    const userAccess = access.get(userId)
    // Staff with no projects (yet) get no report rather than an empty one.
    if (!userAccess || (userAccess !== 'all' && !userAccess.size)) continue
    const chosen = prefs.report_scope === 'per_project' && prefs.report_projects?.length > 0
      ? new Set<string>(prefs.report_projects)
      : null
    const items = allItems.filter(i => {
      const projectId = i.unit?.project_id
      return canSeeProject(userAccess, projectId) && (!chosen || chosen.has(projectId!))
    })

    // Determine period start
    const periodDays = prefs.report_frequency === 'daily' ? 1 : 7
    const periodStart = new Date(now.getTime() - periodDays * 24 * 60 * 60 * 1000)
    const periodLabel = prefs.report_frequency === 'daily'
      ? `Daily report — ${now.toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long' })}`
      : `Weekly report — week ending ${now.toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' })}`

    // Stats
    const byStatus = (s: string) => items.filter(i => i.status === s).length
    const stats = [
      { label: 'Logged', value: byStatus('logged') },
      { label: 'In Progress', value: byStatus('in_progress') + byStatus('assigned') },
      { label: 'Awaiting Inspection', value: byStatus('contractor_complete') },
      { label: 'Complete', value: byStatus('complete') },
    ]

    // Overdue: logged/assigned/in_progress items older than 14 days
    const overdueThreshold = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)
    const overdueItems = items
      .filter(i => ['logged', 'assigned', 'in_progress'].includes(i.status) && new Date(i.created_at) < overdueThreshold)
      .map(i => {
        const unit = i.unit
        const project = unit?.project
        return {
          title: i.title,
          itemNumber: i.item_number,
          unitLabel: formatUnitLabel(unit),
          projectName: project?.name ?? '—',
          daysSince: Math.floor((now.getTime() - new Date(i.created_at).getTime()) / 86400000),
        }
      })
      .sort((a, b) => b.daysSince - a.daysSince)

    // Recently completed: completed_at within period
    const recentlyCompleted = items
      .filter(i => i.status === 'complete' && i.completed_at && new Date(i.completed_at) >= periodStart)
      .map(i => {
        const unit = i.unit
        const project = unit?.project
        return {
          title: i.title,
          itemNumber: i.item_number,
          unitLabel: formatUnitLabel(unit),
          projectName: project?.name ?? '—',
        }
      })

    const { subject, html } = reportEmail({
      reportTitle: 'Maintenance Hub Report',
      periodLabel,
      stats,
      overdueItems,
      recentlyCompleted,
      appUrl,
    })

    const { error } = await sendEmail({ to: email, subject, html })
    if (!error) sent++
  }

  return Response.json({ sent })
}

// Vercel Cron invokes routes with GET
export { POST as GET }
