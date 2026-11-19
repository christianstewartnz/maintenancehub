/** Per-project documents (maintenance form, maintenance letter …) attached to owner reminder drafts. */

export const PROJECT_DOCUMENTS_BUCKET = 'project-documents'
/** Matches the bucket's file_size_limit. */
export const MAX_PROJECT_DOCUMENT_BYTES = 20 * 1024 * 1024

export interface ProjectDocument {
  id: string
  project_id: string
  file_name: string
  storage_path: string
  content_type: string | null
  size_bytes: number | null
  attach_to_reminder: boolean
  created_at: string
}

/** Storage path for a new upload; keeps a readable copy of the name for debugging. */
export function projectDocumentPath(projectId: string, fileName: string) {
  const safe = fileName.replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '_').slice(-80) || 'file'
  return `${projectId}/${crypto.randomUUID()}-${safe}`
}
