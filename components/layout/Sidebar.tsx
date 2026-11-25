'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
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
import { fetchMyPendingNotify, COUNTS_CHANGED_EVENT } from '@/lib/contractor-notify'
import StratumLogo from '@/components/ui/StratumLogo'

const NAV_ITEMS = [
  { href: '/dashboard',    label: 'Dashboard',    icon: LayoutDashboard },
  { href: '/projects',     label: 'Projects',     icon: FolderKanban },
  { href: '/maintenance',  label: 'Maintenance',  icon: Wrench },
  { href: '/contractors',  label: 'Contractors',  icon: Users },
  { href: '/work-orders',  label: 'Work Orders',  icon: ClipboardList },
  { href: '/sign-off',     label: 'Sign-off',     icon: CheckCheck },
  { href: '/settings',     label: 'Settings',     icon: Settings },
]

export default function Sidebar({ isAdmin = false }: { isAdmin?: boolean }) {
  const pathname = usePathname()
  const router = useRouter()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [signOffCount, setSignOffCount] = useState(0)
  const [notifyCount, setNotifyCount] = useState(0)
  const [woRequestCount, setWoRequestCount] = useState(0)
  const supabase = createClient()

  useEffect(() => {
    async function fetchCount() {
      const [{ count }, { data: { session } }, { count: requestCount }] = await Promise.all([
        supabase
          .from('maintenance_items')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'contractor_complete')
          .eq('has_steps', false) // a job split into steps is signed off through its steps
          .is('archived_at', null),
        supabase.auth.getSession(),
        // Contractor work order requests waiting for an answer (RLS: projects I can see)
        supabase
          .from('work_order_requests')
          .select('id, item:maintenance_items!inner(archived_at)', { count: 'exact', head: true })
          .eq('status', 'pending')
          .is('item.archived_at', null),
      ])
      setSignOffCount(count ?? 0)
      setWoRequestCount(requestCount ?? 0)
      // "To notify" is only the user's own items (effective responsible = me): that's what they can send.
      // getSession() is only used for the user id here, not to authorise anything (RLS does that).
      const userId = session?.user.id
      if (!userId) return
      const { mine } = await fetchMyPendingNotify(supabase, userId, { select: 'id, assigned_to, parent_item_id, unit:units(project_id)' })
      setNotifyCount(mine.length)
    }
    fetchCount()
    const channel = supabase
      .channel('sidebar_signoff_count')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'maintenance_items' }, fetchCount)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_order_requests' }, fetchCount)
      .subscribe()
    // Realtime isn't guaranteed to fire for every change, so also refresh when the app says counts moved.
    window.addEventListener(COUNTS_CHANGED_EVENT, fetchCount)
    return () => {
      supabase.removeChannel(channel)
      window.removeEventListener(COUNTS_CHANGED_EVENT, fetchCount)
    }
  }, [])

  // Refresh on navigation too (e.g. after assigning items, then opening Contractors).
  useEffect(() => {
    window.dispatchEvent(new Event(COUNTS_CHANGED_EVENT))
  }, [pathname])

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
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 600, color: '#37352f' }}>
              <StratumLogo size={20} />
              Maintenance Hub
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
            const badgeCount = href === '/sign-off' ? signOffCount
              : href === '/contractors' ? notifyCount
              : href === '/work-orders' ? woRequestCount
              : 0
            const badgeColor = href === '/contractors' ? '#2383e2' : href === '/work-orders' ? '#d9730d' : '#e03c3c'
            const badgeTitle = href === '/contractors' ? `${notifyCount} of your assigned item${notifyCount !== 1 ? 's' : ''} not yet emailed to contractors`
              : href === '/work-orders' ? `${woRequestCount} work order request${woRequestCount !== 1 ? 's' : ''} from contractors waiting for an answer`
              : undefined
            const showBadge = badgeCount > 0
            return (
              <Link
                key={href}
                href={href}
                className={`sidebar-nav-item ${active ? 'active' : ''}`}
                onClick={() => setMobileOpen(false)}
                title={collapsed ? label : undefined}
                style={{ position: 'relative' }}
              >
                <span style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
                  <Icon size={18} style={{ color: active ? '#37352f' : '#787774' }} />
                  {showBadge && collapsed && (
                    <span style={{
                      position: 'absolute', top: -4, right: -4,
                      minWidth: 14, height: 14, borderRadius: 7,
                      background: badgeColor, color: 'white',
                      fontSize: 9, fontWeight: 700,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      padding: '0 3px', lineHeight: 1,
                      border: '1.5px solid white',
                    }}>
                      {badgeCount > 99 ? '99+' : badgeCount}
                    </span>
                  )}
                </span>
                {!collapsed && <span>{label}</span>}
                {showBadge && !collapsed && (
                  <span title={badgeTitle} style={{
                    marginLeft: 'auto',
                    minWidth: 18, height: 18, borderRadius: 9,
                    background: badgeColor, color: 'white',
                    fontSize: 11, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: '0 5px', lineHeight: 1,
                  }}>
                    {badgeCount > 99 ? '99+' : badgeCount}
                  </span>
                )}
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
