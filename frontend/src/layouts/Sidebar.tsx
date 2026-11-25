import React, { useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Globe2,
  Inbox,
  Send,
  AlertOctagon,
  RotateCw,
  BarChart3,
  Settings,
  Flame,
  X,
  ChevronLeft,
  ChevronRight,
  CalendarClock,
  FlaskConical,
  LayoutTemplate,
} from 'lucide-react'
import { cn } from '../utils/cn'
import { useApp } from '../context/AppContext'

interface NavItem {
  label: string
  path: string
  icon: React.ComponentType<{ className?: string }>
  badge?: string
}

interface NavGroup {
  groupTitle: string
  items: NavItem[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    groupTitle: 'WORKSPACE',
    items: [
      { label: 'Overview', path: '/', icon: LayoutDashboard },
      { label: 'Endpoints', path: '/endpoints', icon: Globe2 },
      { label: 'Templates', path: '/templates', icon: LayoutTemplate },
      { label: 'Events', path: '/events', icon: Inbox },
      { label: 'Deliveries', path: '/deliveries', icon: Send },
      { label: 'Scheduled', path: '/scheduled-deliveries', icon: CalendarClock },
    ],
  },
  {
    groupTitle: 'OPERATIONS',
    items: [
      { label: 'Dead Letter Queue', path: '/dead-letters', icon: AlertOctagon, badge: '3' },
      { label: 'Replay Queue', path: '/replay', icon: RotateCw },
      { label: 'Endpoint Testing', path: '/endpoint-testing', icon: FlaskConical },
    ],
  },
  {
    groupTitle: 'INSIGHTS',
    items: [
      { label: 'Analytics', path: '/analytics', icon: BarChart3 },
    ],
  },
  {
    groupTitle: 'PREFERENCES',
    items: [
      { label: 'Settings', path: '/settings', icon: Settings },
    ],
  },
]

interface SidebarProps {
  isOpen: boolean
  onClose: () => void
  isCollapsed?: boolean
  onToggleCollapse?: () => void
}

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  onClose,
  isCollapsed = false,
  onToggleCollapse,
}) => {
  const { backendHealth } = useApp()
  const isDbUp = backendHealth.status === 'up'
  const isChecking = backendHealth.status === 'checking'

  // Close mobile drawer on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  // Prevent background page scrolling while mobile drawer is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  // Automatically close mobile drawer and reset overflow if resized to desktop (>= 1024px)
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024 && isOpen) {
        onClose()
      }
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [isOpen, onClose])

  return (
    <>
      {/* Mobile / Tablet Backdrop Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-xs lg:hidden transition-opacity duration-300"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Main Sidebar Container (Slide-in drawer on mobile/tablet; sticky collapsible on desktop) */}
      <aside
        aria-label="Sidebar Navigation"
        className={cn(
          'fixed inset-y-0 left-0 z-50 bg-white border-r border-[#E7E8EC] flex flex-col justify-between transition-all duration-300 ease-in-out lg:translate-x-0 lg:sticky lg:top-0 lg:h-screen lg:shrink-0 overflow-x-hidden',
          isOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full lg:shadow-none',
          isCollapsed ? 'lg:w-20' : 'lg:w-64',
          'w-72 max-w-[85vw] lg:max-w-none'
        )}
      >
        {/* Top: Brand Header */}
        <div className="flex-1 flex flex-col min-h-0 overflow-y-auto overflow-x-hidden">
          <div
            className={cn(
              'h-16 flex items-center border-b border-[#E7E8EC] transition-all px-4 sm:px-5 justify-between',
              isCollapsed && 'lg:justify-center lg:px-4'
            )}
          >
            <NavLink
              to="/"
              onClick={() => {
                if (isOpen) onClose()
              }}
              className="flex items-center gap-2.5 group shrink-0"
              title="HookForge Home"
            >
              <div className="w-8 h-8 rounded-lg bg-[#5277D9] text-white flex items-center justify-center shadow-xs group-hover:bg-[#4366C4] transition-colors shrink-0">
                <Flame className="w-5 h-5 text-white" />
              </div>

              <span
                className={cn(
                  'font-bold text-[#202938] tracking-tight text-base leading-none whitespace-nowrap',
                  isCollapsed ? 'block lg:hidden' : 'block'
                )}
              >
                HookForge
              </span>
            </NavLink>

            {/* Desktop collapse toggle button */}
            {onToggleCollapse && (
              <button
                type="button"
                onClick={onToggleCollapse}
                className={cn(
                  'hidden lg:flex items-center justify-center p-1.5 rounded-lg text-[#64748B] hover:text-[#202938] hover:bg-[#F7F6F2] transition-colors cursor-pointer',
                  isCollapsed && 'hidden'
                )}
                title="Collapse sidebar (desktop)"
                aria-label="Collapse sidebar"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}

            {/* Mobile / Tablet close drawer button */}
            <button
              onClick={onClose}
              className="lg:hidden text-[#64748B] hover:text-[#202938] p-1.5 rounded-lg hover:bg-[#F7F6F2] transition-colors cursor-pointer"
              aria-label="Close sidebar drawer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Grouped Navigation Links */}
          <nav
            aria-label="Workspace Navigation"
            className={cn('pt-4 pb-6 space-y-5 px-3', isCollapsed && 'lg:px-2')}
          >
            {NAV_GROUPS.map((group) => (
              <div key={group.groupTitle} className="space-y-1">
                {/* Group Title: always visible on mobile drawer; hidden only when desktop is collapsed */}
                <div
                  className={cn(
                    'px-3 text-3xs font-bold text-[#64748B] tracking-wider uppercase mb-1.5 select-none',
                    isCollapsed ? 'block lg:hidden' : 'block'
                  )}
                >
                  {group.groupTitle}
                </div>

                {/* Divider when desktop is collapsed */}
                <div
                  className={cn(
                    'h-px bg-[#E7E8EC] my-2 mx-2 hidden',
                    isCollapsed && 'lg:block'
                  )}
                />

                {group.items.map((item) => {
                  const Icon = item.icon
                  return (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      onClick={() => {
                        if (isOpen) onClose()
                      }}
                      title={isCollapsed ? item.label : undefined}
                      className={({ isActive }) =>
                        cn(
                          'flex items-center rounded-lg text-xs font-medium transition-all group cursor-pointer relative',
                          isCollapsed
                            ? 'px-3 py-2 justify-between lg:justify-center lg:p-2.5'
                            : 'justify-between px-3 py-2',
                          isActive
                            ? 'bg-[#EAF0FF] text-[#5277D9] font-semibold shadow-2xs'
                            : 'text-[#64748B] hover:text-[#202938] hover:bg-[#F7F6F2]'
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <div
                            className={cn(
                              'flex items-center min-w-0 gap-3',
                              isCollapsed && 'lg:justify-center lg:gap-0'
                            )}
                          >
                            <Icon
                              className={cn(
                                'w-4 h-4 shrink-0 transition-colors',
                                isActive
                                  ? 'text-[#5277D9]'
                                  : 'text-[#64748B] group-hover:text-[#202938]'
                              )}
                            />
                            <span
                              className={cn(
                                'truncate',
                                isCollapsed && 'lg:hidden'
                              )}
                            >
                              {item.label}
                            </span>
                          </div>

                          {/* Full badge on mobile drawer and desktop expanded */}
                          {item.badge && (
                            <span
                              className={cn(
                                'px-1.5 py-0.2 text-3xs rounded-full font-bold shrink-0 ml-2 border',
                                isCollapsed && 'lg:hidden',
                                isActive
                                  ? 'bg-[#E76B64] text-white border-[#E76B64]'
                                  : 'bg-[#E76B64]/10 text-[#E76B64] border-[#E76B64]/20 group-hover:bg-[#E76B64]/20'
                              )}
                            >
                              {item.badge}
                            </span>
                          )}

                          {/* Collapsed dot badge only on desktop when collapsed */}
                          {isCollapsed && item.badge && (
                            <span className="hidden lg:block absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#E76B64]" />
                          )}
                        </>
                      )}
                    </NavLink>
                  )
                })}
              </div>
            ))}
          </nav>
        </div>

        {/* Collapsed Expand Trigger (Desktop Only) */}
        {isCollapsed && onToggleCollapse && (
          <div className="hidden lg:flex justify-center p-2 border-t border-[#E7E8EC]">
            <button
              type="button"
              onClick={onToggleCollapse}
              className="p-2 rounded-lg text-[#64748B] hover:text-[#202938] hover:bg-[#F7F6F2] transition-colors cursor-pointer"
              title="Expand sidebar"
              aria-label="Expand sidebar"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Bottom System Status Panel (Real-time telemetry) */}
        <div className="border-t border-[#E7E8EC] bg-white p-2 shrink-0">
          {/* Collapsed view only on desktop when collapsed */}
          <div
            className={cn(
              'flex-col items-center py-1 gap-1 text-2xs cursor-pointer group',
              isCollapsed ? 'hidden lg:flex' : 'hidden'
            )}
            title={`System Status: ${isDbUp ? 'Healthy' : isChecking ? 'Checking' : 'Degraded'} | Database: ${isDbUp ? 'Connected' : 'Offline'} | Delivery Engine: ${isDbUp ? 'Active' : 'Halted'}`}
          >
            <div
              className={cn(
                'w-2 h-2 rounded-full border',
                isDbUp
                  ? 'bg-[#159B78] border-[#159B78]/40 shadow-xs'
                  : isChecking
                  ? 'bg-[#E5B34B] border-[#E5B34B]/40 animate-pulse'
                  : 'bg-[#E76B64] border-[#E76B64]/40'
              )}
            />
            <span className="text-3xs text-[#64748B] font-mono leading-none">
              {isDbUp ? 'UP' : isChecking ? '...' : 'OFF'}
            </span>
          </div>

          {/* Full status view on mobile drawer and expanded desktop */}
          <div
            className={cn(
              'p-2 rounded-md bg-[#F7F6F2] border border-[#E7E8EC] space-y-1.5 text-3xs',
              isCollapsed && 'lg:hidden'
            )}
          >
            <div className="flex items-center justify-between text-[#64748B]">
              <span className="font-semibold uppercase tracking-wider text-3xs text-[#64748B] select-none">
                SYSTEM STATUS
              </span>
              <span className="inline-flex items-center gap-1 font-medium whitespace-nowrap">
                <span
                  className={cn(
                    'w-1.5 h-1.5 rounded-full inline-block shrink-0',
                    isDbUp ? 'bg-[#159B78]' : isChecking ? 'bg-[#E5B34B]' : 'bg-[#E76B64]'
                  )}
                />
                <span className={cn(isDbUp ? 'text-[#159B78]' : isChecking ? 'text-[#E5B34B]' : 'text-[#E76B64]')}>
                  {isDbUp ? 'Healthy' : isChecking ? 'Checking' : 'Degraded'}
                </span>
              </span>
            </div>

            <div className="space-y-1 pt-1 border-t border-[#E7E8EC]/80">
              <div className="flex items-center justify-between text-[#64748B]">
                <span>Database</span>
                <span className={cn('font-medium whitespace-nowrap', isDbUp ? 'text-[#159B78]' : 'text-[#E76B64]')}>
                  {isDbUp ? 'Connected' : isChecking ? 'Checking...' : 'Offline'}
                </span>
              </div>

              <div className="flex items-center justify-between text-[#64748B]">
                <span>Delivery Engine</span>
                <span className={cn('font-medium whitespace-nowrap', isDbUp ? 'text-[#202938]' : 'text-[#E76B64]')}>
                  {isDbUp ? 'Active' : 'Halted'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  )
}
