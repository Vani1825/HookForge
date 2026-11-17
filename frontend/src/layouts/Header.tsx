import React, { useState, useEffect } from 'react'
import { Menu, Plus, Send, Search, MoreVertical, Bell } from 'lucide-react'
import { ModeToggle } from '../components/ModeToggle'
import { Button } from '../components/ui/Button'
import { useLocation } from 'react-router-dom'
import { useNotifications } from '../context/NotificationContext'
import { NotificationPanel } from '../components/NotificationPanel'

interface HeaderProps {
  onOpenMobileMenu: () => void
  onOpenSendEvent: () => void
  onOpenAddEndpoint: () => void
  onOpenSearch: () => void
}

export const Header: React.FC<HeaderProps> = ({
  onOpenMobileMenu,
  onOpenSendEvent,
  onOpenAddEndpoint,
  onOpenSearch,
}) => {
  const location = useLocation()
  const { unreadCount, isPanelOpen, setIsPanelOpen, togglePanel } = useNotifications()
  const [mobileOverflowOpen, setMobileOverflowOpen] = useState(false)

  // Close mobile overflow menu on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && mobileOverflowOpen) {
        setMobileOverflowOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [mobileOverflowOpen])

  const getPageSectionAndTitle = (pathname: string) => {
    switch (pathname) {
      case '/':
        return { section: 'Workspace', title: 'Overview' }
      case '/endpoints':
        return { section: 'Workspace', title: 'Endpoints' }
      case '/events':
        return { section: 'Workspace', title: 'Events' }
      case '/deliveries':
        return { section: 'Workspace', title: 'Deliveries' }
      case '/dead-letters':
        return { section: 'Operations', title: 'Dead Letter Queue' }
      case '/replay':
        return { section: 'Operations', title: 'Replay Queue' }
      case '/analytics':
        return { section: 'Insights', title: 'Analytics' }
      case '/settings':
        return { section: 'Preferences', title: 'Settings' }
      default:
        return { section: 'HookForge', title: 'Dashboard' }
    }
  }

  const { section, title } = getPageSectionAndTitle(location.pathname)
  const isEndpointsPage = location.pathname === '/endpoints'

  return (
    <header className="h-16 bg-white border-b border-[#E7E8EC] px-3 sm:px-4 lg:px-6 flex items-center justify-between gap-2 sm:gap-4 sticky top-0 z-30">
      {/* Left: Mobile/Tablet Drawer Trigger & Breadcrumbs */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <button
          onClick={onOpenMobileMenu}
          className="lg:hidden p-2 text-[#64748B] hover:text-[#202938] hover:bg-[#F7F6F2] rounded-lg cursor-pointer shrink-0 transition-colors"
          aria-label="Open navigation menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Desktop & Tablet Breadcrumbs (Hidden on small mobile) */}
        <nav aria-label="Breadcrumb" className="hidden sm:flex items-center gap-1.5 text-xs text-[#64748B] min-w-0">
          <span className="font-medium text-[#64748B] shrink-0">HookForge</span>
          <span className="text-[#CBD5E1] shrink-0">/</span>
          <span className="font-medium text-[#64748B] hidden lg:inline shrink-0">{section}</span>
          <span className="text-[#CBD5E1] hidden lg:inline shrink-0">/</span>
          <span className="font-semibold text-[#202938] truncate">{title}</span>
        </nav>

        {/* Mobile Page Title */}
        <span className="sm:hidden font-bold text-sm text-[#202938] truncate">
          {title}
        </span>
      </div>

      {/* Middle: Global Search Trigger (Desktop & Tablet) */}
      <div className="hidden md:flex items-center flex-1 max-w-[180px] lg:max-w-xs mx-2 xl:mx-4 min-w-0">
        <button
          type="button"
          onClick={onOpenSearch}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[#64748B] bg-[#F7F6F2] border border-[#E7E8EC] rounded-lg hover:border-[#D1D5DB] hover:bg-white transition-all cursor-pointer text-left"
          title="Search endpoints, events, deliveries (⌘K / Ctrl+K)"
          aria-label="Open search dialog"
        >
          <Search className="w-3.5 h-3.5 text-[#64748B] shrink-0" />
          <span className="flex-1 truncate">Quick search...</span>
          <kbd className="hidden lg:inline-block px-1.5 py-0.5 text-3xs font-semibold bg-white text-[#64748B] border border-[#E7E8EC] rounded shadow-2xs">
            ⌘K
          </kbd>
        </button>
      </div>

      {/* Right Desktop & Tablet: Actions, Mode Toggle, and Developer Profile */}
      <div className="hidden md:flex items-center gap-1.5 sm:gap-2.5 shrink-0">
        {/* Quick Send Event Action */}
        <Button
          variant="outline"
          size="sm"
          onClick={onOpenSendEvent}
          leftIcon={<Send className="w-3.5 h-3.5 text-[#64748B]" />}
          className="inline-flex text-xs px-2 sm:px-2.5 py-1.5"
          title="Send test webhook event"
        >
          <span className="hidden lg:inline">Send Event</span>
          <span className="lg:hidden">Send</span>
        </Button>

        {/* Quick Add Endpoint Action (Hidden on Endpoints page to eliminate duplicate action) */}
        {!isEndpointsPage && (
          <Button
            variant="primary"
            size="sm"
            onClick={onOpenAddEndpoint}
            leftIcon={<Plus className="w-3.5 h-3.5" />}
            className="inline-flex text-xs px-2 sm:px-2.5 py-1.5"
            title="Register webhook endpoint"
          >
            <span className="hidden lg:inline">Add Endpoint</span>
            <span className="lg:hidden">Add</span>
          </Button>
        )}

        <div className="h-4 w-px bg-[#E7E8EC] mx-0.5" />

        {/* In-App Notifications Bell */}
        <button
          type="button"
          onClick={togglePanel}
          className="relative p-2 text-[#64748B] hover:text-[#202938] hover:bg-[#F7F6F2] rounded-lg transition-colors cursor-pointer"
          aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
          aria-expanded={isPanelOpen}
          title={unreadCount > 0 ? `${unreadCount} unread notifications` : 'Notifications'}
        >
          <Bell className="w-4 h-4 text-[#64748B]" />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 flex items-center justify-center min-w-[16px] h-4 px-1 text-4xs font-bold text-white bg-[#E76B64] rounded-full shadow-2xs border-2 border-white leading-none">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>

        {/* Live / Demo Mode Switcher */}
        <ModeToggle />

        {/* Developer Profile Avatar */}
        <div
          className="w-8 h-8 rounded-full bg-[#EAF0FF] text-[#5277D9] border border-[#DCE5FA] flex items-center justify-center font-bold text-xs select-none shadow-2xs shrink-0 cursor-default"
          title="Developer Workspace (Default Dev Tenant)"
        >
          DEV
        </div>
      </div>

      {/* Right Mobile: Compact Search, Primary Add Button, and Overflow Menu */}
      <div className="flex md:hidden items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={onOpenSearch}
          className="p-2 text-[#64748B] hover:text-[#202938] hover:bg-[#F7F6F2] rounded-lg transition-colors cursor-pointer"
          title="Search (⌘K)"
          aria-label="Open search"
        >
          <Search className="w-4 h-4" />
        </button>

        {!isEndpointsPage ? (
          <button
            type="button"
            onClick={onOpenAddEndpoint}
            className="p-2 rounded-lg bg-[#5277D9] text-white hover:bg-[#4366C4] transition-colors cursor-pointer shadow-xs flex items-center justify-center"
            title="Add Endpoint"
            aria-label="Add Endpoint"
          >
            <Plus className="w-4 h-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onOpenSendEvent}
            className="p-2 rounded-lg bg-[#5277D9] text-white hover:bg-[#4366C4] transition-colors cursor-pointer shadow-xs flex items-center justify-center"
            title="Send Test Event"
            aria-label="Send Test Event"
          >
            <Send className="w-4 h-4" />
          </button>
        )}

        {/* Mobile Notification Bell */}
        <button
          type="button"
          onClick={togglePanel}
          className="relative p-2 text-[#64748B] hover:text-[#202938] hover:bg-[#F7F6F2] rounded-lg transition-colors cursor-pointer"
          aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
          aria-expanded={isPanelOpen}
          title={unreadCount > 0 ? `${unreadCount} unread notifications` : 'Notifications'}
        >
          <Bell className="w-4 h-4 text-[#64748B]" />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 flex items-center justify-center min-w-[16px] h-4 px-1 text-4xs font-bold text-white bg-[#E76B64] rounded-full shadow-2xs border-2 border-white leading-none">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => setMobileOverflowOpen((prev) => !prev)}
            className="p-2 text-[#64748B] hover:text-[#202938] hover:bg-[#F7F6F2] rounded-lg transition-colors cursor-pointer"
            aria-label="More actions and settings"
            aria-expanded={mobileOverflowOpen}
          >
            <MoreVertical className="w-4 h-4" />
          </button>

          {mobileOverflowOpen && (
            <>
              {/* Backdrop */}
              <div
                className="fixed inset-0 z-40 bg-black/10"
                onClick={() => setMobileOverflowOpen(false)}
                aria-hidden="true"
              />
              {/* Dropdown Menu */}
              <div
                className="absolute right-0 top-full mt-2 z-50 w-64 max-w-[calc(100vw-24px)] bg-white rounded-xl shadow-xl border border-[#E7E8EC] p-3 space-y-3 animate-fade-in text-xs text-left"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Header info */}
                <div className="flex items-center justify-between pb-2 border-b border-[#E7E8EC]">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-[#EAF0FF] text-[#5277D9] border border-[#DCE5FA] flex items-center justify-center font-bold text-2xs shrink-0">
                      DEV
                    </div>
                    <span className="font-semibold text-[#202938] truncate">Developer Workspace</span>
                  </div>
                </div>

                {/* Mode switch */}
                <div className="space-y-1.5">
                  <span className="text-3xs font-semibold text-[#64748B] uppercase tracking-wider block">
                    Operation Mode
                  </span>
                  <div className="overflow-x-auto">
                    <ModeToggle showStatusBadge={false} />
                  </div>
                </div>

                {/* Quick Actions */}
                <div className="space-y-1 pt-1 border-t border-[#E7E8EC]">
                  <button
                    type="button"
                    onClick={() => {
                      setMobileOverflowOpen(false)
                      togglePanel()
                    }}
                    className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg hover:bg-[#F7F6F2] text-[#202938] font-medium transition-colors cursor-pointer text-left"
                  >
                    <div className="flex items-center gap-2">
                      <Bell className="w-3.5 h-3.5 text-[#5277D9] shrink-0" />
                      <span>Notifications</span>
                    </div>
                    {unreadCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full text-4xs font-bold bg-[#E76B64] text-white">
                        {unreadCount}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMobileOverflowOpen(false)
                      onOpenSendEvent()
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-[#F7F6F2] text-[#202938] font-medium transition-colors cursor-pointer text-left"
                  >
                    <Send className="w-3.5 h-3.5 text-[#5277D9] shrink-0" />
                    <span>Send Test Event</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMobileOverflowOpen(false)
                      onOpenAddEndpoint()
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-[#F7F6F2] text-[#202938] font-medium transition-colors cursor-pointer text-left"
                  >
                    <Plus className="w-3.5 h-3.5 text-[#5277D9] shrink-0" />
                    <span>Add Webhook Endpoint</span>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* In-App Notification Panel Dropdown */}
      {isPanelOpen && <NotificationPanel onClose={() => setIsPanelOpen(false)} />}
    </header>
  )
}
