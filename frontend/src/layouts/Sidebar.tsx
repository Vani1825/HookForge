import React from 'react'
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
} from 'lucide-react'
import { cn } from '../utils/cn'

interface SidebarProps {
  isOpen: boolean
  onClose: () => void
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose }) => {

  const navItems = [
    { label: 'Dashboard', path: '/', icon: LayoutDashboard },
    { label: 'Endpoints', path: '/endpoints', icon: Globe2 },
    { label: 'Events', path: '/events', icon: Inbox },
    { label: 'Deliveries', path: '/deliveries', icon: Send },
    { label: 'Dead Letters', path: '/dead-letters', icon: AlertOctagon, badge: '3' },
    { label: 'Replay Queue', path: '/replay', icon: RotateCw },
    { label: 'Analytics', path: '/analytics', icon: BarChart3 },
    { label: 'Settings', path: '/settings', icon: Settings },
  ]

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-xs lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Sidebar container */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 w-64 bg-white border-r border-slate-200/90 flex flex-col justify-between transition-transform duration-200 ease-in-out lg:translate-x-0 lg:static',
          isOpen ? 'translate-x-0 shadow-xl' : '-translate-x-full lg:shadow-none'
        )}
      >
        {/* Top: Brand & Logo */}
        <div>
          <div className="h-16 px-6 flex items-center justify-between border-b border-slate-100">
            <NavLink to="/" className="flex items-center gap-2.5 group">
              <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center shadow-xs group-hover:bg-slate-800 transition-colors">
                <Flame className="w-5 h-5 text-amber-400" />
              </div>
              <div className="flex flex-col">
                <span className="font-bold text-slate-900 tracking-tight text-base leading-none">
                  HookForge
                </span>
                <span className="text-2xs text-slate-500 font-medium tracking-wide uppercase mt-0.5">
                  Webhook Reliability
                </span>
              </div>
            </NavLink>

            <button
              onClick={onClose}
              className="lg:hidden text-slate-400 hover:text-slate-600 p-1 rounded-md"
              aria-label="Close sidebar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Navigation Links */}
          <nav className="p-3 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  onClick={() => onClose()}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center justify-between px-3.5 py-2 rounded-lg text-xs font-medium transition-all group cursor-pointer',
                      isActive
                        ? 'bg-slate-900 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <div className="flex items-center gap-3">
                        <Icon
                          className={cn(
                            'w-4 h-4 transition-colors',
                            isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-700'
                          )}
                        />
                        <span>{item.label}</span>
                      </div>
                      {item.badge && (
                        <span
                          className={cn(
                            'px-1.5 py-0.5 text-2xs rounded-full font-bold',
                            isActive
                              ? 'bg-rose-500 text-white'
                              : 'bg-rose-100 text-rose-700 group-hover:bg-rose-200'
                          )}
                        >
                          {item.badge}
                        </span>
                      )}
                    </>
                  )}
                </NavLink>
              )
            })}
          </nav>
        </div>

        {/* Bottom Platform Architecture Card */}
        <div className="p-4 border-t border-slate-100">
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/70 text-2xs text-slate-500 space-y-1.5">
            <div className="flex items-center justify-between font-medium text-slate-700">
              <span>Engine Status</span>
              <span className="text-emerald-700 font-semibold bg-emerald-100/70 px-1.5 py-0.2 rounded">
                Durable Queue
              </span>
            </div>
            <p className="leading-tight text-slate-500">
              PostgreSQL <code className="text-2xs text-slate-700">FOR UPDATE SKIP LOCKED</code> queue with
              atomic ordering.
            </p>
          </div>
        </div>
      </aside>
    </>
  )
}
