interface PageHeaderProps {
  title: string
  description?: string
  emoji?: string
  actions?: React.ReactNode
  breadcrumbs?: { label: string; href?: string }[]
}

export default function PageHeader({ title, description, emoji, actions, breadcrumbs }: PageHeaderProps) {
  return (
    <div style={{ padding: '28px 32px 0', borderBottom: '1px solid #e9e9e7', marginBottom: 0 }}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav style={{ display: 'flex', gap: 6, fontSize: 13, color: '#787774', marginBottom: 8 }}>
          {breadcrumbs.map((crumb, i) => (
            <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {i > 0 && <span>/</span>}
              {crumb.href ? (
                <a href={crumb.href} style={{ color: '#787774', textDecoration: 'none' }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#37352f')}
                  onMouseLeave={e => (e.currentTarget.style.color = '#787774')}>
                  {crumb.label}
                </a>
              ) : (
                <span>{crumb.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', paddingBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: '#37352f', margin: 0 }}>
            {emoji && <span style={{ marginRight: 8 }}>{emoji}</span>}
            {title}
          </h1>
          {description && (
            <p style={{ color: '#787774', fontSize: 14, marginTop: 4, marginBottom: 0 }}>{description}</p>
          )}
        </div>
        {actions && <div style={{ display: 'flex', gap: 8, flexShrink: 0, marginLeft: 16 }}>{actions}</div>}
      </div>
    </div>
  )
}
