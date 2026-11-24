import { createServiceClient } from '@/lib/supabase/service'
import { refuseIfNotVisible } from '../../_lib/visible'
import { ATTACHMENTS_BUCKET, MAX_PHOTO_BYTES, SIGNED_URL_TTL_SECONDS, photoStoragePath } from '@/lib/photos'

const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/gif']

/**
 * Contractor uploads an "after" (completion) photo from the portal.
 * Runs with the service role, so every check that RLS would normally do happens here:
 * the token must match a contractor, and the item must be assigned to them and still open.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  const form = await req.formData().catch(() => null)
  const itemId = form?.get('item_id')
  const file = form?.get('file')

  if (typeof itemId !== 'string' || !(file instanceof File)) {
    return Response.json({ error: 'item_id and file are required' }, { status: 400 })
  }
  const contentType = file.type || 'image/jpeg'
  if (!ALLOWED_TYPES.includes(contentType)) {
    return Response.json({ error: 'Only image files can be uploaded' }, { status: 400 })
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return Response.json({ error: 'Photo is too large (max 10MB)' }, { status: 413 })
  }

  const supabase = createServiceClient()

  const { data: contractor } = await supabase
    .from('contractors').select('id, company_name').eq('portal_token', token).maybeSingle()
  if (!contractor) return Response.json({ error: 'Invalid token' }, { status: 401 })

  const { data: item } = await supabase
    .from('maintenance_items').select('id, status')
    .eq('id', itemId).eq('contractor_id', contractor.id).maybeSingle()
  if (!item) return Response.json({ error: 'Item not found' }, { status: 404 })
  if (item.status === 'complete') return Response.json({ error: 'This item is already signed off' }, { status: 400 })
  // Only items shown on their portal (released, open, not hidden).
  const refused = await refuseIfNotVisible(supabase, token, item.id)
  if (refused) return refused

  const path = photoStoragePath(item.id, contentType)
  const { error: upErr } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .upload(path, file, { contentType })
  if (upErr) return Response.json({ error: upErr.message }, { status: 500 })

  const { data: row, error: insErr } = await supabase
    .from('maintenance_item_attachments')
    .insert({
      maintenance_item_id: item.id,
      file_url: path,
      file_type: contentType,
      file_name: file.name.slice(0, 200),
      uploaded_by: contractor.company_name,
      photo_type: 'after',
    })
    .select()
    .single()
  if (insErr || !row) {
    await supabase.storage.from(ATTACHMENTS_BUCKET).remove([path])
    return Response.json({ error: insErr?.message ?? 'Could not save photo' }, { status: 500 })
  }

  await supabase.from('activity_log').insert({
    maintenance_item_id: item.id,
    action: 'photo_added',
    details: { photo_type: 'after', file_name: row.file_name },
    performed_by: contractor.company_name,
  })

  // Contractor is working on it: Logged/Assigned → In Progress
  const { data: status } = await supabase.rpc('portal_mark_started', { p_token: token, p_item_id: item.id })

  const { data: signed } = await supabase.storage.from(ATTACHMENTS_BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
  return Response.json({ data: { ...row, url: signed?.signedUrl ?? null }, status })
}
