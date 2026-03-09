/**
 * IBM Carbon Design System Layout
 * Flat white left-navigation panel + 48 px shell header
 * Spec: https://carbondesignsystem.com/components/UI-shell-left-panel/usage
 */
import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  LayoutDashboard,
  Layers,
  Activity,
  GitCompare,
  CalendarClock,
  Settings,
  Zap,
  Menu,
  X,
  Bell,
  Search,
  ChevronDown,
  User,
  LogOut,
} from 'lucide-react';

// ── Navigation config ────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { label: 'Dashboard',    href: '/',           icon: LayoutDashboard },
  { label: 'Workloads',    href: '/workloads',   icon: Layers          },
  { label: 'View Results', href: '/executions',  icon: Activity        },
  { label: 'Compare Tests',href: '/compare',     icon: GitCompare      },
  { label: 'Scheduling',   href: '/schedules',   icon: CalendarClock   },
];

interface LayoutProps { children: React.ReactNode }

export default function Layout({ children }: LayoutProps) {
  const router = useRouter();
  const [profileOpen, setProfileOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const isActive = (href: string) =>
    href === '/' ? router.pathname === '/' : router.pathname.startsWith(href);

  return (
    <div className="min-h-screen flex" style={{ background: '#f4f4f4' }}>

      {/* ── Mobile overlay ──────────────────────────────────────────────── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 lg:hidden"
          style={{ background: 'rgba(22,22,22,0.5)' }}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Left Navigation Panel ────────────────────────────────────────
          Use ONLY Tailwind classes for position/transform so breakpoints work.
          Inline style is only for Carbon color tokens.
      ─────────────────────────────────────────────────────────────────── */}
      <aside
        className={[
          // Structural — Tailwind handles breakpoint logic
          'fixed inset-y-0 left-0 z-30',
          'lg:static lg:inset-auto',
          'w-64 flex flex-col',
          'transition-transform duration-200',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        ].join(' ')}
        style={{ background: '#ffffff', borderRight: '1px solid #e0e0e0' }}
      >
        {/* ── Product name strip (dark Carbon shell) ── */}
        <div
          className="flex items-center gap-3 px-4 flex-shrink-0"
          style={{
            height: '48px',
            background: '#161616',
            borderBottom: '1px solid #393939',
          }}
        >
          {/* Square product icon */}
          <div
            className="flex items-center justify-center flex-shrink-0"
            style={{ width: '20px', height: '20px', background: '#0f62fe' }}
          >
            <Zap style={{ width: '12px', height: '12px', color: '#ffffff' }} />
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold leading-none" style={{ color: '#f4f4f4' }}>
              PerfSight
            </p>
            <p className="text-xs mt-0.5" style={{ color: '#8d8d8d' }}>
              JMeter Platform
            </p>
          </div>

          <button
            className="lg:hidden btn-icon"
            style={{ color: '#8d8d8d' }}
            onClick={() => setSidebarOpen(false)}
          >
            <X style={{ width: '16px', height: '16px' }} />
          </button>
        </div>

        {/* ── Nav links ── */}
        <nav className="flex-1 overflow-y-auto py-2">
          <p
            className="px-4 pt-3 pb-2 text-xs font-semibold uppercase"
            style={{ color: '#6f6f6f', letterSpacing: '0.08em' }}
          >
            Platform
          </p>

          {NAV_ITEMS.map(({ label, href, icon: Icon }) => {
            const active = isActive(href);
            return (
              <NavItem key={href} href={href} active={active} icon={Icon} label={label} />
            );
          })}

          <div style={{ borderTop: '1px solid #e0e0e0', margin: '8px 0' }} />

          <p
            className="px-4 pt-2 pb-2 text-xs font-semibold uppercase"
            style={{ color: '#6f6f6f', letterSpacing: '0.08em' }}
          >
            System
          </p>

          <NavItem
            href="/environments"
            active={router.pathname === '/environments'}
            icon={Settings}
            label="Environments"
          />
        </nav>

        {/* ── Bottom user strip ── */}
        <div className="px-4 py-3" style={{ borderTop: '1px solid #e0e0e0' }}>
          <div className="flex items-center gap-3">
            {/* Square avatar */}
            <div
              className="flex items-center justify-center flex-shrink-0 text-white font-bold"
              style={{
                width: '28px', height: '28px',
                background: '#0f62fe',
                fontSize: '11px',
              }}
            >
              AS
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold truncate" style={{ color: '#161616' }}>
                Ashwin Shenoy
              </p>
              <p className="text-xs truncate" style={{ color: '#6f6f6f' }}>
                Administrator
              </p>
            </div>
          </div>

          <a
            href="/api/v1/health"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 flex items-center gap-1.5 text-xs no-underline"
            style={{ color: '#6f6f6f' }}
          >
            <span
              className="inline-block flex-shrink-0"
              style={{ width: '6px', height: '6px', background: '#42be65' }}
            />
            API Connected
          </a>
        </div>
      </aside>

      {/* ── Right side: header + page content ──────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0">

        {/* ── Shell Header — 48 px ── */}
        <header
          className="sticky top-0 z-10 flex items-center gap-3 px-4 flex-shrink-0"
          style={{
            height: '48px',
            background: '#ffffff',
            borderBottom: '1px solid #e0e0e0',
          }}
        >
          {/* Mobile hamburger */}
          <button className="btn-icon lg:hidden" onClick={() => setSidebarOpen(true)}>
            <Menu style={{ width: '18px', height: '18px' }} />
          </button>

          {/* Carbon search input */}
          <div className="relative" style={{ flex: '0 0 280px', maxWidth: '100%' }}>
            <Search
              className="absolute top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ left: '10px', width: '14px', height: '14px', color: '#8d8d8d' }}
            />
            <input
              type="search"
              placeholder="Search workloads, executions…"
              className="w-full"
              style={{
                height: '32px',
                paddingLeft: '34px',
                paddingRight: '12px',
                fontSize: '13px',
                background: '#f4f4f4',
                border: 'none',
                borderBottom: '1px solid #8d8d8d',
                borderRadius: 0,
                color: '#161616',
                outline: 'none',
              }}
              onFocus={e => {
                e.currentTarget.style.background = '#ffffff';
                e.currentTarget.style.borderBottomColor = '#0f62fe';
                e.currentTarget.style.outline = '2px solid #0f62fe';
                e.currentTarget.style.outlineOffset = '-2px';
              }}
              onBlur={e => {
                e.currentTarget.style.background = '#f4f4f4';
                e.currentTarget.style.borderBottomColor = '#8d8d8d';
                e.currentTarget.style.outline = 'none';
              }}
            />
          </div>

          <div className="flex-1" />

          {/* Notifications */}
          <button className="btn-icon relative" aria-label="Notifications">
            <Bell style={{ width: '16px', height: '16px' }} />
            <span
              className="absolute"
              style={{
                top: '6px', right: '6px',
                width: '6px', height: '6px',
                background: '#0f62fe',
              }}
            />
          </button>

          {/* Profile dropdown */}
          <div className="relative">
            <button
              className="flex items-center gap-2 transition-colors"
              style={{ height: '48px', padding: '0 12px', background: 'transparent', border: 'none', cursor: 'pointer', color: '#161616', fontSize: '14px' }}
              onClick={() => setProfileOpen(o => !o)}
              onMouseEnter={e => (e.currentTarget.style.background = '#f4f4f4')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              {/* Square avatar */}
              <div
                className="flex items-center justify-center flex-shrink-0 text-white font-bold"
                style={{ width: '24px', height: '24px', background: '#0f62fe', fontSize: '10px' }}
              >
                AS
              </div>
              <span className="hidden sm:block font-medium">Ashwin</span>
              <ChevronDown className="hidden sm:block" style={{ width: '14px', height: '14px', color: '#8d8d8d' }} />
            </button>

            {profileOpen && (
              <div
                className="absolute right-0 z-50"
                style={{
                  top: '48px',
                  width: '200px',
                  background: '#ffffff',
                  border: '1px solid #e0e0e0',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.20)',
                }}
                onMouseLeave={() => setProfileOpen(false)}
              >
                <div className="px-4 py-3" style={{ borderBottom: '1px solid #e0e0e0' }}>
                  <p className="text-xs font-semibold" style={{ color: '#161616' }}>Ashwin Shenoy</p>
                  <p className="text-xs mt-0.5" style={{ color: '#6f6f6f' }}>Administrator</p>
                </div>

                {[
                  { icon: User,     label: 'Profile'  },
                  { icon: Settings, label: 'Settings' },
                ].map(({ icon: Icon, label }) => (
                  <button
                    key={label}
                    className="w-full flex items-center gap-2.5 text-left transition-colors"
                    style={{ padding: '10px 16px', fontSize: '13px', color: '#161616', background: 'transparent', border: 'none', cursor: 'pointer' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#f4f4f4')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <Icon style={{ width: '14px', height: '14px' }} />
                    {label}
                  </button>
                ))}

                <div style={{ borderTop: '1px solid #e0e0e0' }}>
                  <button
                    className="w-full flex items-center gap-2.5 text-left transition-colors"
                    style={{ padding: '10px 16px', fontSize: '13px', color: '#da1e28', background: 'transparent', border: 'none', cursor: 'pointer' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#fff1f1')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <LogOut style={{ width: '14px', height: '14px' }} />
                    Sign Out
                  </button>
                </div>
              </div>
            )}
          </div>
        </header>

        {/* ── Page Content ── */}
        <main className="flex-1 p-6 overflow-auto" style={{ background: '#f4f4f4' }}>
          {children}
        </main>
      </div>
    </div>
  );
}

// ── Reusable nav item — avoids repeated hover handler boilerplate ─────────
function NavItem({
  href,
  active,
  icon: Icon,
  label,
}: {
  href: string;
  active: boolean;
  icon: React.ElementType;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-4 text-sm transition-colors no-underline"
      style={{
        height: '48px',
        fontWeight:      active ? 600 : 400,
        color:           active ? '#161616' : '#525252',
        background:      active ? '#e0e0e0' : 'transparent',
        borderLeft:      `4px solid ${active ? '#0f62fe' : 'transparent'}`,
      }}
      onMouseEnter={e => {
        if (!active) {
          (e.currentTarget as HTMLElement).style.background = '#f4f4f4';
          (e.currentTarget as HTMLElement).style.color = '#161616';
        }
      }}
      onMouseLeave={e => {
        if (!active) {
          (e.currentTarget as HTMLElement).style.background = 'transparent';
          (e.currentTarget as HTMLElement).style.color = '#525252';
        }
      }}
    >
      <Icon style={{ width: '16px', height: '16px', flexShrink: 0 }} />
      {label}
    </Link>
  );
}
