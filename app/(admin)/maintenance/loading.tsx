export default function MaintenanceLoading() {
  return (
    <div className="page-content" style={{ padding: '24px 32px' }}>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <div className="skeleton" style={{ flex: 1, height: 36, maxWidth: 320 }} />
        {[1, 2, 3, 4].map(i => <div key={i} className="skeleton" style={{ width: 120, height: 36 }} />)}
      </div>
      <div style={{ border: '1px solid #e9e9e7', borderRadius: 8, overflow: 'hidden' }}>
        {[1, 2, 3, 4, 5, 6].map(i => (
          <div key={i} style={{ display: 'flex', gap: 16, padding: '12px 16px', borderBottom: '1px solid #f1f1ef' }}>
            <div className="skeleton" style={{ width: 80, height: 14 }} />
            <div className="skeleton" style={{ flex: 1, height: 14 }} />
            <div className="skeleton" style={{ width: 90, height: 14 }} />
            <div className="skeleton" style={{ width: 70, height: 20, borderRadius: 9999 }} />
            <div className="skeleton" style={{ width: 50, height: 14 }} />
          </div>
        ))}
      </div>
    </div>
  )
}
