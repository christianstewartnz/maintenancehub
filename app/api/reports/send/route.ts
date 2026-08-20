import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { reportEmail } from '@/lib/email-templates'

// Called by Vercel cron or manually: POST /api/reports/send
// Requires Bearer token matching CRON_SECRET env var
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

  // Find all users with a report preference (not 'none')
  const { data: prefRows } = await serviceSupabase
    .from('notification_preferences')
    .select('user_id, report_frequency, report_scope, report_projects')
    .neq('report_frequency', 'none')

  if (!prefRows?.length) return Response.json({ sent: 0 })

  const now = new Date()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const resend = new Resend(process.env.RESEND_API_KEY)
  const from = process.env.RESEND_FROM_EMAIL ?? 'Maintenance Hub <noreply@maintenancehub.co.nz>'

  let sent = 0

  for (const prefs of prefRows) {
    const { data: { user } } = await serviceSupabase.auth.admin.getUserById(prefs.user_id)
    if (!user?.email) continue

    // Determine period start
    const periodDays = prefs.report_frequency === 'daily' ? 1 : 7
    const periodStart = new Date(now.getTime() - periodDays * 24 * 60 * 60 * 1000)
    const periodLabel = prefs.report_frequency === 'daily'
      ? `Daily report — ${now.toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long' })}`
      : `Weekly report — week ending ${now.toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' })}`

    // Query maintenance items
    let query = serviceSupabase
      .from('maintenance_items')
      .select('id, item_number, title, status, priority, created_at, completed_at, unit:units(unit_identifier, project:projects(id, name))')

    if (prefs.report_scope === 'per_project' && prefs.report_projects?.length > 0) {
      // Filter to specific projects via units
      const { data: units } = await serviceSupabase
        .from('units')
        .select('id')
        .in('project_id', prefs.report_projects)
      const unitIds = units?.map(u => u.id) ?? []
      if (unitIds.length > 0) query = query.in('unit_id', unitIds)
    }

    const { data: allItems } = await query

    const items = allItems ?? []

    // Stats
    const byStatus = (s: string) => items.filter(i => i.status === s).length
    const stats = [
      { label: 'Logged', value: byStatus('logged') },
      { label: 'In Progress', value: byStatus('in_progress') + byStatus('assigned') },
      { label: 'Awaiting Inspection', value: byStatus('contractor_complete') },
      { label: 'Complete', value: byStatus('complete') + byStatus('confirmed') },
    ]

    // Overdue: logged/assigned/in_progress items older than 14 days
    const overdueThreshold = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)
    const overdueItems = items
      .filter(i => ['logged', 'assigned', 'in_progress'].includes(i.status) && new Date(i.created_at) < overdueThreshold)
      .map(i => {
        const unit = i.unit as any
        const project = unit?.project as any
        return {
          title: i.title,
          itemNumber: i.item_number,
          unitIdentifier: unit?.unit_identifier ?? '—',
          projectName: project?.name ?? '—',
          daysSince: Math.floor((now.getTime() - new Date(i.created_at).getTime()) / 86400000),
        }
      })
      .sort((a, b) => b.daysSince - a.daysSince)

    // Recently completed: completed_at within period
    const recentlyCompleted = items
      .filter(i => ['complete', 'confirmed'].includes(i.status) && i.completed_at && new Date(i.completed_at) >= periodStart)
      .map(i => {
        const unit = i.unit as any
        const project = unit?.project as any
        return {
          title: i.title,
          itemNumber: i.item_number,
          unitIdentifier: unit?.unit_identifier ?? '—',
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

    await resend.emails.send({ from, to: user.email, subject, html })
    sent++
  }

  return Response.json({ sent })
}
