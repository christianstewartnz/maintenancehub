import PageHeader from '@/components/layout/PageHeader'

export default function SettingsPage() {
  return (
    <div>
      <PageHeader
        emoji="⚙️"
        title="Settings"
        description="Configure notifications, SLA thresholds, and preferences"
      />
      <div style={{ padding: '24px 32px', maxWidth: 600 }}>
        <div style={{ border: '1px solid #e9e9e7', borderRadius: 8, padding: '20px 24px', marginBottom: 16 }}>
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

        <div style={{ border: '1px solid #e9e9e7', borderRadius: 8, padding: '20px 24px' }}>
          <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 600 }}>Notifications</h3>
          <p style={{ color: '#787774', fontSize: 14, marginTop: 0, marginBottom: 16 }}>Email notification settings — coming in Phase 3.</p>
          <p style={{ color: '#b0aea8', fontSize: 13 }}>Full notification and report configuration will be available once email integration (Resend) is configured.</p>
        </div>
      </div>
    </div>
  )
}
