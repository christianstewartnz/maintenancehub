'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import {
  LayoutDashboard,
  FolderKanban,
  Wrench,
  Users,
  ClipboardList,
  Settings,
  ChevronLeft,
  ChevronRight,
  Menu,
  LogOut,
  CheckCheck,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

const NAV_ITEMS = [
  { href: '/dashboard',    label: 'Dashboard',    icon: LayoutDashboard },
  { href: '/projects',     label: 'Projects',     icon: FolderKanban },
  { href: '/maintenance',  label: 'Maintenance',  icon: Wrench },
  { href: '/contractors',  label: 'Contractors',  icon: Users },
  { href: '/work-orders',  label: 'Work Orders',  icon: ClipboardList },
  { href: '/sign-off',     label: 'Sign-off',     icon: CheckCheck },
  { href: '/settings',     label: 'Settings',     icon: Settings },
]

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const supabase = createClient()

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/auth/login')
    router.refresh()
  }

  return (
    <>
      {/* Mobile hamburger — visible only on mobile via .mobile-only CSS class */}
      <button
        className="btn btn-ghost mobile-only"
        onClick={() => setMobileOpen(true)}
        style={{ position: 'fixed', top: 12, left: 12, zIndex: 50 }}
        aria-label="Open menu"
      >
        <Menu size={20} />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 39 }}
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside className={`sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          padding: '16px 14px 12px',
          borderBottom: '1px solid #e9e9e7',
          minHeight: 52,
        }}>
          {!collapsed && (
            <span style={{ fontSize: 15, fontWeight: 600, color: '#37352f' }}>
              🏗️ Maintenance Hub
            </span>
          )}
          <button
            className="btn btn-ghost"
            onClick={() => setCollapsed(!collapsed)}
            style={{ padding: '4px 6px', color: '#787774' }}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '10px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || (href !== '/' && pathname.startsWith(href))
            return (
              <Link
                key={href}
                href={href}
                className={`sidebar-nav-item ${active ? 'active' : ''}`}
                onClick={() => setMobileOpen(false)}
                title={collapsed ? label : undefined}
              >
                <Icon size={18} style={{ flexShrink: 0, color: active ? '#37352f' : '#787774' }} />
                {!collapsed && <span>{label}</span>}
              </Link>
            )
          })}
        </nav>

        {/* Footer */}
        <div style={{ padding: '10px 8px', borderTop: '1px solid #e9e9e7' }}>
          <button
            className="sidebar-nav-item"
            style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', justifyContent: collapsed ? 'center' : 'flex-start' }}
            onClick={handleLogout}
            title={collapsed ? 'Sign out' : undefined}
          >
            <LogOut size={18} style={{ flexShrink: 0, color: '#787774' }} />
            {!collapsed && <span style={{ color: '#787774' }}>Sign out</span>}
          </button>
        </div>
      </aside>
    </>
  )
}
