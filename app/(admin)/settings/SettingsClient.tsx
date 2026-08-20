'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { NotificationPreferences, Project } from '@/lib/types'

interface Props {
  prefs: NotificationPreferences | null
  userId: string
  projects: Project[]
}

export default function SettingsClient({ prefs: initial, userId, projects }: Props) {
  const [contractorComplete, setContractorComplete] = useState(initial?.contractor_complete_email ?? true)
  const [contractorComment, setContractorComment] = useState(initial?.contractor_comment_email ?? true)
  const [frequency, setFrequency] = useState<'daily' | 'weekly' | 'none'>(initial?.report_frequency ?? 'weekly')
  const [scope, setScope] = useState<'all_projects' | 'per_project'>(initial?.report_scope ?? 'all_projects')
  const [selectedProjects, setSelectedProjects] = useState<string[]>(initial?.report_projects ?? [])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const supabase = createClient()

  function toggleProject(id: string) {
    setSelectedProjects(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    )
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setSaved(false)

    const record = {
      user_id: userId,
      contractor_complete_email: contractorComplete,
      contractor_comment_email: contractorComment,
      report_frequency: frequency,
      report_scope: scope,
      report_projects: scope === 'per_project' ? selectedProjects : [],
      updated_at: new Date().toISOString(),
    }

    if (initial?.id) {
      await supabase.from('notification_preferences').update(record).eq('id', initial.id)
    } else {
      await supabase.from('notification_preferences').insert({ ...record, created_at: new Date().toISOString() })
    }

    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  return (
    <form onSubmit={handleSave} style={{ maxWidth: 640 }}>

      {/* Contractor notifications */}
      <div style={{ border: '1px solid #e9e9e7', borderRadius: 8, padding: '20px 24px', marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 600 }}>Contractor Notifications</h3>
        <p style={{ color: '#787774', fontSize: 14, marginTop: 0, marginBottom: 16 }}>
          Email alerts when contractors take action on the portal.
        </p>

        <label style={checkboxRow}>
          <input
            type="checkbox"
            checked={contractorComplete}
            onChange={e => setContractorComplete(e.target.checked)}
            style={{ marginRight: 10, accentColor: '#2383e2' }}
          />
          <div>
            <span style={{ fontSize: 14, fontWeight: 500 }}>Work ready for inspection</span>
            <p style={{ margin: '2px 0 0', fontSize: 13, color: '#787774' }}>
              Email me when a contractor marks an item as complete.
            </p>
          </div>
        </label>

        <label style={{ ...checkboxRow, marginTop: 14 }}>
          <input
            type="checkbox"
            checked={contractorComment}
            onChange={e => setContractorComment(e.target.checked)}
            style={{ marginRight: 10, accentColor: '#2383e2' }}
          />
          <div>
            <span style={{ fontSize: 14, fontWeight: 500 }}>New contractor comment</span>
            <p style={{ margin: '2px 0 0', fontSize: 13, color: '#787774' }}>
              Email me when a contractor leaves a comment.
            </p>
          </div>
        </label>
      </div>

      {/* Scheduled reports */}
      <div style={{ border: '1px solid #e9e9e7', borderRadius: 8, padding: '20px 24px', marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 600 }}>Scheduled Reports</h3>
        <p style={{ color: '#787774', fontSize: 14, marginTop: 0, marginBottom: 16 }}>
          Periodic maintenance summaries with status counts, overdue items, and recent completions.
        </p>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Report frequency</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['daily', 'weekly', 'none'] as const).map(f => (
              <button
                key={f}
                type="button"
                onClick={() => setFrequency(f)}
                style={{
                  padding: '6px 14px',
                  borderRadius: 6,
                  border: '1px solid',
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: 'pointer',
                  borderColor: frequency === f ? '#2383e2' : '#e9e9e7',
                  background: frequency === f ? '#ebf3fd' : 'white',
                  color: frequency === f ? '#2383e2' : '#37352f',
                }}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {frequency !== 'none' && (
          <>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Report scope</label>
              <select
                className="input"
                value={scope}
                onChange={e => setScope(e.target.value as 'all_projects' | 'per_project')}
                style={{ width: 240 }}
              >
                <option value="all_projects">All projects</option>
                <option value="per_project">Specific projects</option>
              </select>
            </div>

            {scope === 'per_project' && projects.length > 0 && (
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Projects to include</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {projects.map(p => (
                    <label key={p.id} style={checkboxRow}>
                      <input
                        type="checkbox"
                        checked={selectedProjects.includes(p.id)}
                        onChange={() => toggleProject(p.id)}
                        style={{ marginRight: 10, accentColor: '#2383e2' }}
                      />
                      <span style={{ fontSize: 14 }}>{p.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* SLA thresholds (static display — not yet persisted) */}
      <div style={{ border: '1px solid #e9e9e7', borderRadius: 8, padding: '20px 24px', marginBottom: 24 }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 600 }}>SLA Thresholds</h3>
        <p style={{ color: '#787774', fontSize: 14, marginTop: 0, marginBottom: 16 }}>Items approaching these thresholds are highlighted on the dashboard.</p>
        <div style={{ display: 'flex', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 5 }}>Amber warning (days)</label>
            <input className="input" type="number" defaultValue={7} min={1} style={{ width: 100 }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 5 }}>Red overdue (days)</label>
            <input className="input" type="number" defaultValue={14} min={1} style={{ width: 100 }} />
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save settings'}
        </button>
        {saved && <span style={{ fontSize: 13, color: '#0f7b0f' }}>Saved</span>}
      </div>
    </form>
  )
}

const checkboxRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  cursor: 'pointer',
}
