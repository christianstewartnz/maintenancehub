export default function WorkOrdersLoading() {
  return (
    <div className="page-content" style={{ padding: '24px 32px' }}>
      <div style={{ border: '1px solid #e9e9e7', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ display: 'flex', gap: 16, padding: '10px 16px', borderBottom: '1px solid #e9e9e7', background: '#f7f7f5' }}>
          {['#', 'Project', 'Contractor', 'Status', 'Created', 'Sent'].map(h => (
            <div key={h} className="skeleton" style={{ width: h === '#' ? 50 : 100, height: 12 }} />
          ))}
        </div>
        {[1, 2, 3, 4].map(i => (
          <div key={i} style={{ display: 'flex', gap: 16, padding: '12px 16px', borderBottom: '1px solid #f1f1ef' }}>
            <div className="skeleton" style={{ width: 50, height: 14 }} />
            <div className="skeleton" style={{ width: 120, height: 14 }} />
            <div className="skeleton" style={{ width: 130, height: 14 }} />
            <div className="skeleton" style={{ width: 80, height: 20, borderRadius: 9999 }} />
            <div className="skeleton" style={{ width: 80, height: 14 }} />
            <div className="skeleton" style={{ width: 80, height: 14 }} />
          </div>
        ))}
      </div>
    </div>
  )
}
