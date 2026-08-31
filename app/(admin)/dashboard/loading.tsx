export default function DashboardLoading() {
  return (
    <div className="page-content" style={{ padding: '24px 32px' }}>
      <div className="stat-grid-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 28 }}>
        {[1, 2, 3].map(i => (
          <div key={i} style={{ border: '1px solid #e9e9e7', borderRadius: 8, padding: '16px 20px' }}>
            <div className="skeleton" style={{ width: 60, height: 36, marginBottom: 8 }} />
            <div className="skeleton" style={{ width: 130, height: 14 }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {[1, 2, 3].map(i => (
          <div key={i} style={{ border: '1px solid #e9e9e7', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ background: '#f7f7f5', padding: '12px 16px' }}>
              <div className="skeleton" style={{ width: 200, height: 18 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
