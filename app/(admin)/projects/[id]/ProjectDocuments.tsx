'use client'

import { useEffect, useRef, useState } from 'react'
import { FileText, Upload, Trash2, Download } from 'lucide-react'
import type { ProjectDocument } from '@/lib/project-documents'

type Doc = ProjectDocument & { url: string | null }

function formatSize(bytes: number | null) {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Project documents (maintenance form, letter …) attached to owner reminder email drafts. */
export default function ProjectDocuments({ projectId }: { projectId: string }) {
  const [docs, setDocs] = useState<Doc[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  async function fetchDocs(): Promise<{ docs: Doc[]; error: string | null }> {
    const res = await fetch(`/api/projects/${projectId}/documents`)
    const json = await res.json().catch(() => ({}))
    return res.ok ? { docs: json.documents ?? [], error: null } : { docs: [], error: json.error ?? 'Could not load documents' }
  }

  async function load() {
    const r = await fetchDocs()
    setDocs(r.docs)
    if (r.error) setError(r.error)
  }

  useEffect(() => {
    let cancelled = false
    fetchDocs().then(r => {
      if (cancelled) return
      setDocs(r.docs)
      if (r.error) setError(r.error)
    })
    return () => { cancelled = true }
  }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function upload(files: FileList | null) {
    if (!files?.length) return
    setBusy(true)
    setError(null)
    for (const file of Array.from(files)) {
      const body = new FormData()
      body.append('file', file)
      const res = await fetch(`/api/projects/${projectId}/documents`, { method: 'POST', body })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setError(`${file.name}: ${json.error ?? 'upload failed'}`)
      }
    }
    if (fileInput.current) fileInput.current.value = ''
    await load()
    setBusy(false)
  }

  async function toggleAttach(doc: Doc) {
    setDocs(d => d?.map(x => x.id === doc.id ? { ...x, attach_to_reminder: !doc.attach_to_reminder } : x) ?? null)
    const res = await fetch(`/api/projects/${projectId}/documents/${doc.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attach_to_reminder: !doc.attach_to_reminder }),
    })
    if (!res.ok) { setError('Could not update document'); load() }
  }

  async function remove(doc: Doc) {
    if (!confirm(`Delete "${doc.file_name}"? This removes it from future reminder drafts.`)) return
    setBusy(true)
    const res = await fetch(`/api/projects/${projectId}/documents/${doc.id}`, { method: 'DELETE' })
    if (!res.ok) setError('Could not delete document')
    await load()
    setBusy(false)
  }

  return (
    <div style={{ padding: '0 32px 32px' }}>
      <div style={{ border: '1px solid #e9e9e7', borderRadius: 8, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Maintenance reminder documents</div>
            <div style={{ fontSize: 13, color: '#787774', marginTop: 2 }}>
              Ticked files are attached to the 90-day reminder email drafts for this project&apos;s owners (e.g. the maintenance form and letter).
            </div>
          </div>
          <input ref={fileInput} type="file" multiple hidden onChange={e => upload(e.target.files)} />
          <button className="btn btn-ghost" style={{ fontSize: 13, gap: 6 }} disabled={busy} onClick={() => fileInput.current?.click()}>
            <Upload size={14} /> {busy ? 'Working…' : 'Upload'}
          </button>
        </div>

        {error && <div style={{ fontSize: 13, color: '#eb5757', marginBottom: 8 }}>{error}</div>}

        {docs === null ? (
          <div style={{ fontSize: 13, color: '#787774' }}>Loading…</div>
        ) : docs.length === 0 ? (
          <div style={{ fontSize: 13, color: '#787774' }}>No documents yet. Reminder drafts for this project will have no attachments.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {docs.map(doc => (
              <div key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid #f1f1ef' }}>
                <input
                  type="checkbox"
                  checked={doc.attach_to_reminder}
                  onChange={() => toggleAttach(doc)}
                  title="Attach to reminder drafts"
                  style={{ width: 16, height: 16, cursor: 'pointer' }}
                />
                <FileText size={16} color="#787774" />
                <span style={{ flex: 1, fontSize: 14, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.file_name}</span>
                <span style={{ fontSize: 12, color: '#9b9a97' }}>{formatSize(doc.size_bytes)}</span>
                {doc.url && (
                  <a className="btn btn-ghost" href={doc.url} style={{ padding: 6 }} title="Download"><Download size={14} /></a>
                )}
                <button className="btn btn-ghost" style={{ padding: 6, color: '#eb5757' }} onClick={() => remove(doc)} disabled={busy} title="Delete">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
