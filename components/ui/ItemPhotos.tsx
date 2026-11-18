'use client'

import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Camera, ImagePlus, Trash2, X, Paperclip } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { compressImage, uploadFileName, PHOTO_TYPE_LABELS, type PhotoWithUrl } from '@/lib/photos'
import type { PhotoType } from '@/lib/types'

interface Props {
  initialPhotos: PhotoWithUrl[]
  /** Which sections get an upload button. */
  uploadTypes: PhotoType[]
  /** Upload one (already compressed) image. Return the saved row, or an error message. */
  onUpload: (blob: Blob, fileName: string, type: PhotoType) => Promise<PhotoWithUrl | string>
  /** Optional delete; return an error message on failure. */
  onDelete?: (photo: PhotoWithUrl) => Promise<string | null>
  canDelete?: (photo: PhotoWithUrl) => boolean
  /** Hint under a section, e.g. "Take a photo when the job is done". */
  hints?: Partial<Record<PhotoType, string>>
  onChange?: (photos: PhotoWithUrl[]) => void
  compact?: boolean
}

export default function ItemPhotos({ initialPhotos, uploadTypes, onUpload, onDelete, canDelete, hints, onChange, compact }: Props) {
  const [photos, setPhotosState] = useState(initialPhotos)
  const [uploading, setUploading] = useState<{ type: PhotoType; done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [viewing, setViewing] = useState<PhotoWithUrl | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const photosRef = useRef(initialPhotos)

  function setPhotos(updater: (prev: PhotoWithUrl[]) => PhotoWithUrl[]) {
    const next = updater(photosRef.current)
    photosRef.current = next
    setPhotosState(next)
    onChange?.(next)
  }

  async function handleFiles(type: PhotoType, files: FileList | null) {
    if (!files || files.length === 0) return
    const list = Array.from(files)
    setError(null)
    setUploading({ type, done: 0, total: list.length })
    const errors: string[] = []
    for (let i = 0; i < list.length; i++) {
      const file = list[i]
      if (!file.type.startsWith('image/')) { errors.push(`${file.name}: not an image`); continue }
      const blob = await compressImage(file)
      const result = await onUpload(blob, uploadFileName(file, blob), type)
      if (typeof result === 'string') errors.push(`${file.name}: ${result}`)
      else setPhotos(prev => [...prev, result])
      setUploading({ type, done: i + 1, total: list.length })
    }
    if (errors.length) setError(errors.join('\n'))
    setUploading(null)
  }

  async function handleDelete(photo: PhotoWithUrl) {
    if (!onDelete || !confirm('Delete this photo?')) return
    setDeleting(photo.id)
    const err = await onDelete(photo)
    if (err) setError(err)
    else {
      setPhotos(prev => prev.filter(p => p.id !== photo.id))
      if (viewing?.id === photo.id) setViewing(null)
    }
    setDeleting(null)
  }

  const sections: PhotoType[] = ['before', 'after']
  const other = photos.filter(p => !p.photo_type)
  const size = compact ? 84 : 104

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', gap: 12 }}>
        {sections.map(type => {
          const list = photos.filter(p => p.photo_type === type)
          const canUpload = uploadTypes.includes(type)
          const busy = uploading?.type === type
          return (
            <div key={type} style={{ border: '1px solid #e9e9e7', borderRadius: 8, padding: '10px 12px', background: 'white' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: list.length || hints?.[type] ? 8 : 0 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#37352f' }}>
                  {PHOTO_TYPE_LABELS[type]}s <span style={{ color: '#a0a09e', fontWeight: 400 }}>({list.length})</span>
                </span>
                {canUpload && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginLeft: 'auto' }}>
                    {busy ? (
                      <span style={{ fontSize: 12, color: '#787774', padding: '4px 0' }}>
                        Uploading {Math.min(uploading!.done + 1, uploading!.total)}/{uploading!.total}…
                      </span>
                    ) : (
                      <>
                        <UploadButton camera disabled={!!uploading} label="Take photo" onFiles={files => handleFiles(type, files)} />
                        <UploadButton disabled={!!uploading} label="Add photo" onFiles={files => handleFiles(type, files)} />
                      </>
                    )}
                  </div>
                )}
              </div>
              {hints?.[type] && list.length === 0 && (
                <p style={{ margin: 0, fontSize: 12, color: '#787774' }}>{hints[type]}</p>
              )}
              {list.length === 0 && !hints?.[type] && (
                <p style={{ margin: 0, fontSize: 12, color: '#a0a09e' }}>No photos yet.</p>
              )}
              {list.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {list.map(p => (
                    <Thumb
                      key={p.id}
                      photo={p}
                      size={size}
                      onOpen={() => setViewing(p)}
                      onDelete={onDelete && (canDelete?.(p) ?? true) ? () => handleDelete(p) : undefined}
                      deleting={deleting === p.id}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {other.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#787774', marginBottom: 6 }}>Other attachments</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {other.map(p => p.file_type?.startsWith('image/')
              ? <Thumb key={p.id} photo={p} size={size} onOpen={() => setViewing(p)} />
              : (
                <a key={p.id} href={p.url ?? undefined} target="_blank" rel="noreferrer noopener"
                  style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#2383e2', border: '1px solid #e9e9e7', borderRadius: 6, padding: '6px 10px', textDecoration: 'none' }}>
                  <Paperclip size={12} /> {p.file_name ?? 'File'}
                </a>
              ))}
          </div>
        </div>
      )}

      {error && <p style={{ margin: '8px 0 0', fontSize: 12, color: '#eb5757', whiteSpace: 'pre-wrap' }}>{error}</p>}

      {viewing && createPortal(
        <div
          onClick={() => setViewing(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,15,15,0.85)', zIndex: 1000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        >
          <button
            aria-label="Close"
            onClick={() => setViewing(null)}
            style={{ position: 'absolute', top: 12, right: 12, background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 6, color: 'white', padding: 8, cursor: 'pointer', display: 'flex' }}
          >
            <X size={18} />
          </button>
          {viewing.url && (
            // eslint-disable-next-line @next/next/no-img-element -- signed storage URL
            <img src={viewing.url} alt={viewing.file_name ?? 'Photo'} onClick={e => e.stopPropagation()}
              style={{ maxWidth: '100%', maxHeight: 'calc(100vh - 100px)', objectFit: 'contain', borderRadius: 6 }} />
          )}
          <div onClick={e => e.stopPropagation()} style={{ marginTop: 10, color: 'white', fontSize: 13, textAlign: 'center' }}>
            {viewing.photo_type && <strong>{PHOTO_TYPE_LABELS[viewing.photo_type]}</strong>}
            {viewing.photo_type && ' · '}{viewing.uploaded_by} · {formatDateTime(viewing.created_at)}
            {viewing.url && <> · <a href={viewing.url} target="_blank" rel="noreferrer noopener" style={{ color: '#9cc7f5' }}>Open original</a></>}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

/**
 * `camera` opens the phone's rear camera directly (capture="environment"). It is
 * only shown on touch devices (`.touch-only`); the plain button opens the
 * file/gallery picker everywhere.
 */
function UploadButton({ label, disabled, onFiles, camera }: { label: string; disabled: boolean; onFiles: (f: FileList | null) => void; camera?: boolean }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <>
      <button
        type="button"
        className={camera ? 'btn btn-primary touch-only' : 'btn btn-secondary'}
        style={{ padding: '4px 10px', fontSize: 12, gap: 5 }}
        disabled={disabled}
        onClick={() => ref.current?.click()}
      >
        {camera ? <Camera size={13} /> : <ImagePlus size={13} />} {label}
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        {...(camera ? { capture: 'environment' as const } : { multiple: true })}
        hidden
        onChange={e => { onFiles(e.target.files); e.target.value = '' }}
      />
    </>
  )
}

function Thumb({ photo, size, onOpen, onDelete, deleting }: {
  photo: PhotoWithUrl; size: number; onOpen: () => void; onDelete?: () => void; deleting?: boolean
}) {
  return (
    <div style={{ position: 'relative', width: size, height: size, opacity: deleting ? 0.4 : 1 }}>
      <button type="button" onClick={onOpen} title={`${photo.uploaded_by} · ${formatDateTime(photo.created_at)}`}
        style={{ padding: 0, border: '1px solid #e9e9e7', borderRadius: 6, overflow: 'hidden', width: size, height: size, cursor: 'zoom-in', background: '#f7f7f5', display: 'block' }}>
        {photo.url
          // eslint-disable-next-line @next/next/no-img-element -- signed storage URL
          ? <img src={photo.url} alt={photo.file_name ?? 'Photo'} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          : <span style={{ fontSize: 11, color: '#a0a09e' }}>Unavailable</span>}
      </button>
      {onDelete && (
        <button type="button" aria-label="Delete photo" onClick={onDelete} disabled={deleting}
          style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(255,255,255,0.92)', border: '1px solid #e9e9e7', borderRadius: 4, padding: 3, cursor: 'pointer', display: 'flex', color: '#787774' }}>
          <Trash2 size={12} />
        </button>
      )}
    </div>
  )
}
