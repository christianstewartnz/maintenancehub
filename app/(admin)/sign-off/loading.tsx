export default function SignOffLoading() {
  return (
    <div className="page-content" style={{ padding: '24px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 20 }}>
        <div className="skeleton" style={{ width: 140, height: 36 }} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[1, 2, 3].map(i => (
          <div key={i} style={{ background: 'white', border: '1px solid #e9e9e7', borderRadius: 8, padding: '14px 16px' }}>
            <div style={{ display: 'flex', gap: 14 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <div className="skeleton" style={{ width: 60, height: 14 }} />
                  <div className="skeleton" style={{ width: 50, height: 20, borderRadius: 9999 }} />
                  <div className="skeleton" style={{ width: 70, height: 14 }} />
                </div>
                <div className="skeleton" style={{ width: 260, height: 18, marginBottom: 6 }} />
                <div className="skeleton" style={{ width: 200, height: 13, marginBottom: 4 }} />
                <div className="skeleton" style={{ width: 150, height: 13 }} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div className="skeleton" style={{ width: 100, height: 36 }} />
                <div className="skeleton" style={{ width: 100, height: 36 }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
