import type { SupabaseClient } from '@supabase/supabase-js'
import type { MaintenanceItemAttachment, PhotoType } from '@/lib/types'

export const ATTACHMENTS_BUCKET = 'maintenance-attachments'
/** Signed URLs last long enough for a page left open through a site visit. */
export const SIGNED_URL_TTL_SECONDS = 60 * 60 * 12
/** Server-side cap (after client compression photos are usually < 1MB). */
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024

export type PhotoWithUrl = MaintenanceItemAttachment & { url: string | null }

export const PHOTO_TYPE_LABELS: Record<PhotoType, string> = {
  before: 'Before',
  after: 'After',
}

/** Storage path for a new photo on an item. */
export function photoStoragePath(itemId: string, contentType: string) {
  const ext = contentType === 'image/png' ? 'png'
    : contentType === 'image/webp' ? 'webp'
    : contentType === 'image/heic' ? 'heic'
    : contentType === 'image/gif' ? 'gif'
    : 'jpg'
  return `${itemId}/${crypto.randomUUID()}.${ext}`
}

/**
 * Attach signed URLs to attachment rows. `file_url` holds the storage path; older rows
 * that already hold a full URL are passed through untouched.
 */
export async function withSignedUrls<T extends { file_url: string }>(
  supabase: SupabaseClient,
  rows: T[],
): Promise<(T & { url: string | null })[]> {
  const paths = rows.map(r => r.file_url).filter(p => !/^https?:\/\//.test(p))
  const signed = new Map<string, string>()
  if (paths.length > 0) {
    const { data } = await supabase.storage.from(ATTACHMENTS_BUCKET).createSignedUrls(paths, SIGNED_URL_TTL_SECONDS)
    for (const s of data ?? []) if (s.path && s.signedUrl) signed.set(s.path, s.signedUrl)
  }
  return rows.map(r => ({
    ...r,
    url: /^https?:\/\//.test(r.file_url) ? r.file_url : signed.get(r.file_url) ?? null,
  }))
}

/**
 * Browser only: shrink a phone photo to at most `maxDim` px on its long edge as JPEG.
 * Falls back to the original file if the browser can't decode it (e.g. HEIC outside Safari).
 */
export async function compressImage(file: File, maxDim = 2000, quality = 0.82): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
    return blob && blob.size < file.size ? blob : file
  } catch {
    return file
  }
}

/** Name to store for a compressed upload (keeps the original base name). */
export function uploadFileName(original: File, blob: Blob) {
  if (blob === original) return original.name
  return original.name.replace(/\.[^.]+$/, '') + '.jpg'
}
