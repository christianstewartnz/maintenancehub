import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { canAccessProject, getSession } from '@/lib/auth'
import { PROJECT_DOCUMENTS_BUCKET } from '@/lib/project-documents'
import { buildDraftEml, maintenanceDueDate, ownerReminderEmail, type ReminderAttachment } from '@/lib/owner-reminder'
import { formatUnitLabel } from '@/lib/utils'

// GET /api/maintenance-due/draft/[unitId]
// Downloads the unit owners' 90-day maintenance reminder as an Outlook-ready .eml (an unsent
// message with the project's reminder documents attached). Linked from the weekly
// maintenance-due email; needs a signed-in app user.
export async function GET(req: Request, { params }: { params: Promise<{ unitId: string }> }) {
  const { unitId } = await params
  const session = await getSession()
  if (!session) return Response.redirect(new URL('/auth/login', req.url), 302)
  if (!session.profile.is_active) return new Response('Your account is deactivated', { status: 403 })
  const supabase = await createClient()

  // Access check: the unit and its documents are read with the user's own client, so RLS
  // only returns them if this user can access the project (admin, or staff on it). The
  // service client below only downloads the files of documents that query returned.
  const { data: unit, error } = await supabase
    .from('units')
    .select('id, unit_identifier, address, settlement_date, project:projects(id, name), owners:unit_owners(name, email, created_at)')
    .eq('id', unitId)
    .single()
  if (error || !unit) return new Response('Unit not found', { status: 404 })
  if (!unit.settlement_date) return new Response('This unit has no settlement date, so there is no 90-day due date.', { status: 400 })

  const project = unit.project as unknown as { id: string; name: string } | null
  // Explicit check as well, since the service client is used below.
  if (!project || !(await canAccessProject(project.id))) return new Response('Unit not found', { status: 404 })
  const owners = [...((unit.owners ?? []) as { name: string | null; email: string | null; created_at: string }[])]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))

  const { data: docs } = await supabase
    .from('project_documents')
    .select('file_name, storage_path, content_type')
    .eq('project_id', project?.id ?? '')
    .eq('attach_to_reminder', true)
    .order('created_at')

  const service = createServiceClient()
  const attachments: ReminderAttachment[] = []
  for (const d of docs ?? []) {
    const { data: blob, error: dlErr } = await service.storage.from(PROJECT_DOCUMENTS_BUCKET).download(d.storage_path)
    if (dlErr || !blob) return new Response(`Could not load attachment "${d.file_name}": ${dlErr?.message ?? 'missing'}`, { status: 500 })
    attachments.push({ filename: d.file_name, content: Buffer.from(await blob.arrayBuffer()), contentType: d.content_type ?? undefined })
  }

  const email = ownerReminderEmail({
    owners,
    projectName: project?.name ?? 'your development',
    dueDate: maintenanceDueDate(unit.settlement_date),
  })
  const eml = await buildDraftEml({ ...email, attachments })

  const label = formatUnitLabel(unit, 'unit', ' ').replace(/[\\/:*?"<>|]+/g, '-')
  const filename = `Maintenance reminder - ${label}.eml`
  return new Response(new Uint8Array(eml), {
    headers: {
      'Content-Type': 'message/rfc822',
      'Content-Disposition': `attachment; filename="${filename.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'no-store',
    },
  })
}
