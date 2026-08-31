export default function ProjectsLoading() {
  return (
    <div className="page-content" style={{ padding: '24px 32px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
        {[1, 2, 3].map(i => (
          <div key={i} style={{ border: '1px solid #e9e9e7', borderRadius: 10, padding: '20px' }}>
            <div className="skeleton" style={{ width: 160, height: 20, marginBottom: 10 }} />
            <div className="skeleton" style={{ width: 220, height: 14, marginBottom: 8 }} />
            <div className="skeleton" style={{ width: 100, height: 14 }} />
          </div>
        ))}
      </div>
    </div>
  )
}
