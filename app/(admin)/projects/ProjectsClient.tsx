'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Plus, Building2, ChevronRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { Project } from '@/lib/types'

interface Props {
  projects: (Project & { units: { count: number }[] })[]
}

export default function ProjectsClient({ projects: initial }: Props) {
  const [projects, setProjects] = useState(initial)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ name: '', address: '', description: '' })
  const [saving, setSaving] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const { data, error } = await supabase
      .from('projects')
      .insert({ name: form.name, address: form.address || null, description: form.description || null, status: 'active' as const })
      .select()
      .single()

    if (!error && data) {
      setProjects(prev => [...prev, { ...data, units: [{ count: 0 }] }])
      setShowModal(false)
      setForm({ name: '', address: '', description: '' })
      router.refresh()
    }
    setSaving(false)
  }

  const activeProjects = projects.filter(p => p.status === 'active')
  const archivedProjects = projects.filter(p => p.status === 'archived')

  return (
    <div style={{ padding: '24px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 20 }}>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          <Plus size={16} /> New Project
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="empty-state">
          <Building2 size={40} style={{ marginBottom: 12, color: '#d0d0d0' }} />
          <p style={{ fontSize: 16, fontWeight: 500 }}>No projects yet</p>
          <p style={{ fontSize: 14 }}>Create your first project to get started.</p>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setShowModal(true)}>
            <Plus size={16} /> Create Project
          </button>
        </div>
      ) : (
        <>
          <ProjectList title="Active Projects" projects={activeProjects} />
          {archivedProjects.length > 0 && (
            <ProjectList title="Archived Projects" projects={archivedProjects} style={{ marginTop: 32 }} />
          )}
        </>
      )}

      {/* Create modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>New Project</h2>
              <button className="btn btn-ghost" style={{ padding: '4px 8px' }} onClick={() => setShowModal(false)}>✕</button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label style={labelStyle}>Project name *</label>
                  <input className="input" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Richmond Villas" />
                </div>
                <div>
                  <label style={labelStyle}>Address</label>
                  <input className="input" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="General project address" />
                </div>
                <div>
                  <label style={labelStyle}>Description</label>
                  <textarea className="input" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional notes about this project" />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Creating…' : 'Create Project'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function ProjectList({ title, projects, style }: { title: string; projects: any[]; style?: React.CSSProperties }) {
  return (
    <div style={style}>
      <h2 style={{ fontSize: 13, fontWeight: 600, color: '#787774', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
        {title} ({projects.length})
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {projects.map(p => (
          <Link key={p.id} href={`/projects/${p.id}`} style={{ textDecoration: 'none' }}>
            <div style={{
              border: '1px solid #e9e9e7', borderRadius: 8, padding: '16px 18px',
              background: 'white', transition: 'box-shadow 0.15s, border-color 0.15s', cursor: 'pointer',
            }}
              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#d0d0d0'; (e.currentTarget as HTMLDivElement).style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#e9e9e7'; (e.currentTarget as HTMLDivElement).style.boxShadow = 'none' }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#37352f' }}>{p.name}</h3>
                <ChevronRight size={16} style={{ color: '#b0aea8', flexShrink: 0, marginTop: 2 }} />
              </div>
              {p.address && <p style={{ margin: '4px 0 0', fontSize: 13, color: '#787774' }}>{p.address}</p>}
              <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 13, color: '#787774' }}>
                <span>{p.units?.[0]?.count ?? 0} units</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 5, color: '#37352f' }
