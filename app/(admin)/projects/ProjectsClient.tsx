'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Plus, Building2, ChevronRight, Pencil } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { Project } from '@/lib/types'

interface Props {
  projects: (Project & { units: { count: number }[] })[]
}

export default function ProjectsClient({ projects: initial }: Props) {
  const [projects, setProjects] = useState(initial)
  const [showModal, setShowModal] = useState(false)
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [form, setForm] = useState({ name: '', address: '', description: '', development_company: '' })
  const [editForm, setEditForm] = useState({ name: '', address: '', description: '', development_company: '' })
  const [saving, setSaving] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const { data, error } = await supabase
      .from('projects')
      .insert({ name: form.name, address: form.address || null, description: form.description || null, development_company: form.development_company || null, status: 'active' as const })
      .select()
      .single()

    if (!error && data) {
      setProjects(prev => [...prev, { ...data, units: [{ count: 0 }] }])
      setShowModal(false)
      setForm({ name: '', address: '', description: '', development_company: '' })
      router.refresh()
    }
    setSaving(false)
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editingProject) return
    setSaving(true)
    const { data, error } = await supabase
      .from('projects')
      .update({ name: editForm.name, address: editForm.address || null, description: editForm.description || null, development_company: editForm.development_company || null })
      .eq('id', editingProject.id)
      .select()
      .single()

    if (!error && data) {
      setProjects(prev => prev.map(p => p.id === data.id ? { ...p, ...data } : p))
      setEditingProject(null)
      router.refresh()
    }
    setSaving(false)
  }

  function openEdit(p: Project, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setEditForm({ name: p.name, address: p.address ?? '', description: p.description ?? '', development_company: p.development_company ?? '' })
    setEditingProject(p)
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

      {activeProjects.length === 0 && archivedProjects.length === 0 ? (
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
          <ProjectList projects={activeProjects} onEdit={openEdit} />
          {archivedProjects.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <button
                className="btn btn-ghost"
                style={{ fontSize: 13, color: '#787774', padding: '4px 0' }}
                onClick={() => setShowArchived(s => !s)}
              >
                {showArchived ? `Hide archived (${archivedProjects.length})` : `Show archived (${archivedProjects.length})`}
              </button>
              {showArchived && <ProjectList projects={archivedProjects} onEdit={openEdit} style={{ marginTop: 12, opacity: 0.6 }} />}
            </div>
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
                  <label style={labelStyle}>Development Company</label>
                  <input className="input" value={form.development_company} onChange={e => setForm(f => ({ ...f, development_company: e.target.value }))} placeholder="e.g. Stratum Developments Ltd" />
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

      {/* Edit modal */}
      {editingProject && (
        <div className="modal-overlay" onClick={() => setEditingProject(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Edit Project</h2>
              <button className="btn btn-ghost" style={{ padding: '4px 8px' }} onClick={() => setEditingProject(null)}>✕</button>
            </div>
            <form onSubmit={handleEdit}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label style={labelStyle}>Project name *</label>
                  <input className="input" required value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Richmond Villas" />
                </div>
                <div>
                  <label style={labelStyle}>Development Company</label>
                  <input className="input" value={editForm.development_company} onChange={e => setEditForm(f => ({ ...f, development_company: e.target.value }))} placeholder="e.g. Stratum Developments Ltd" />
                </div>
                <div>
                  <label style={labelStyle}>Address</label>
                  <input className="input" value={editForm.address} onChange={e => setEditForm(f => ({ ...f, address: e.target.value }))} placeholder="General project address" />
                </div>
                <div>
                  <label style={labelStyle}>Description</label>
                  <textarea className="input" value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional notes about this project" />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setEditingProject(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function ProjectList({ projects, onEdit, style }: { projects: any[]; onEdit: (p: any, e: React.MouseEvent) => void; style?: React.CSSProperties }) {
  return (
    <div style={style}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {projects.map(p => (
          <Link key={p.id} href={`/projects/${p.id}`} style={{ textDecoration: 'none' }}>
            <div
              style={{
                border: '1px solid #e9e9e7', borderRadius: 8, padding: '16px 18px',
                background: 'white', transition: 'box-shadow 0.15s, border-color 0.15s', cursor: 'pointer',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#d0d0d0'; (e.currentTarget as HTMLDivElement).style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#e9e9e7'; (e.currentTarget as HTMLDivElement).style.boxShadow = 'none' }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#37352f' }}>{p.name}</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <button
                    onClick={e => onEdit(p, e)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b0aea8', padding: '2px 4px', borderRadius: 4, display: 'flex', alignItems: 'center' }}
                    title="Edit project"
                  >
                    <Pencil size={13} />
                  </button>
                  <ChevronRight size={16} style={{ color: '#b0aea8', flexShrink: 0 }} />
                </div>
              </div>
              {p.development_company && <p style={{ margin: '4px 0 0', fontSize: 13, color: '#37352f', fontWeight: 500 }}>{p.development_company}</p>}
              {p.address && <p style={{ margin: '2px 0 0', fontSize: 13, color: '#787774' }}>{p.address}</p>}
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
