import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { canAccessProject, requireUser } from '@/lib/auth'
import { PROJECT_DOCUMENTS_BUCKET } from '@/lib/project-documents'

// PATCH  /api/projects/[id]/documents/[docId] — { attach_to_reminder: boolean }
// DELETE /api/projects/[id]/documents/[docId] — remove the file and its row

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; docId: string }> }) {
  const { id, docId } = await params
  const auth = await requireUser()
  if (auth.error) return auth.error
  // Checked through RLS before the service client (which bypasses it) touches storage
  if (!(await canAccessProject(id))) return Response.json({ error: 'Project not found' }, { status: 404 })
  const supabase = await createClient()

  const body = await req.json().catch(() => ({}))
  if (typeof body.attach_to_reminder !== 'boolean') return Response.json({ error: 'attach_to_reminder must be true or false' }, { status: 400 })

  const { data, error } = await supabase
    .from('project_documents')
    .update({ attach_to_reminder: body.attach_to_reminder })
    .eq('id', docId)
    .eq('project_id', id)
    .select()
    .single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ document: data })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; docId: string }> }) {
  const { id, docId } = await params
  const auth = await requireUser()
  if (auth.error) return auth.error
  // Checked through RLS before the service client (which bypasses it) touches storage
  if (!(await canAccessProject(id))) return Response.json({ error: 'Project not found' }, { status: 404 })
  const supabase = await createClient()

  const { data: doc } = await supabase
    .from('project_documents')
    .select('id, storage_path')
    .eq('id', docId)
    .eq('project_id', id)
    .single()
  if (!doc) return Response.json({ error: 'Document not found' }, { status: 404 })

  const { error } = await supabase.from('project_documents').delete().eq('id', docId)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  await createServiceClient().storage.from(PROJECT_DOCUMENTS_BUCKET).remove([doc.storage_path])
  return Response.json({ ok: true })
}
