import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { canAccessProject, requireUser } from '@/lib/auth'
import { PROJECT_DOCUMENTS_BUCKET, MAX_PROJECT_DOCUMENT_BYTES, projectDocumentPath } from '@/lib/project-documents'

// GET  /api/projects/[id]/documents — list the project's documents (with short-lived download URLs)
// POST /api/projects/[id]/documents — upload one file (multipart form field "file")

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireUser()
  if (auth.error) return auth.error
  // Checked through RLS before the service client (which bypasses it) touches storage
  if (!(await canAccessProject(id))) return Response.json({ error: 'Project not found' }, { status: 404 })
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('project_documents')
    .select('*')
    .eq('project_id', id)
    .order('created_at')
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const service = createServiceClient()
  const docs = await Promise.all((data ?? []).map(async d => {
    const { data: signed } = await service.storage
      .from(PROJECT_DOCUMENTS_BUCKET)
      .createSignedUrl(d.storage_path, 60 * 60, { download: d.file_name })
    return { ...d, url: signed?.signedUrl ?? null }
  }))
  return Response.json({ documents: docs })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireUser()
  if (auth.error) return auth.error
  const { user } = auth.session
  // Checked through RLS before the service client (which bypasses it) touches storage
  if (!(await canAccessProject(id))) return Response.json({ error: 'Project not found' }, { status: 404 })
  const supabase = await createClient()

  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0) return Response.json({ error: 'No file uploaded' }, { status: 400 })
  if (file.size > MAX_PROJECT_DOCUMENT_BYTES) return Response.json({ error: 'File is larger than 20 MB' }, { status: 400 })

  const service = createServiceClient()
  const path = projectDocumentPath(id, file.name)
  const contentType = file.type || 'application/octet-stream'
  const { error: upErr } = await service.storage
    .from(PROJECT_DOCUMENTS_BUCKET)
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType, upsert: false })
  if (upErr) return Response.json({ error: upErr.message }, { status: 500 })

  const { data: doc, error } = await supabase
    .from('project_documents')
    .insert({ project_id: id, file_name: file.name, storage_path: path, content_type: contentType, size_bytes: file.size, created_by: user.id })
    .select()
    .single()
  if (error) {
    await service.storage.from(PROJECT_DOCUMENTS_BUCKET).remove([path])
    return Response.json({ error: error.message }, { status: 500 })
  }
  return Response.json({ document: doc })
}
