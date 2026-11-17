import React, { useState, useEffect, useRef } from 'react'
import {
  Bell,
  BellOff,
  CheckCheck,
  Check,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Info,
  X,
  RefreshCw,
  ExternalLink,
  Trash2,
} from 'lucide-react'
import { useNotifications } from '../context/NotificationContext'
import { ConfirmationDialog } from './ui/ConfirmationDialog'
import type { AppNotification, NotificationSeverity } from '../types'
import { formatRelativeTime, formatDateTime } from '../utils/formatters'
import { useNavigate } from 'react-router-dom'
import { cn } from '../utils/cn'

interface NotificationPanelProps {
  onClose: () => void
}

export const NotificationPanel: React.FC<NotificationPanelProps> = ({ onClose }) => {
  const {
    notifications,
    unreadCount,
    filter,
    setFilter,
    filteredNotifications,
    markAsRead,
    markAllAsRead,
    removeNotification,
    clearAll,
    isLoading,
    error,
    refreshNotifications,
  } = useNotifications()

  const navigate = useNavigate()
  const panelRef = useRef<HTMLDivElement>(null)
  const [confirmClearOpen, setConfirmClearOpen] = useState(false)

  // Close panel on Escape key (only if confirmation dialog is not open)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !confirmClearOpen) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, confirmClearOpen])

  // Handle clicking a notification
  const handleItemClick = (notification: AppNotification) => {
    if (!notification.read) {
      markAsRead(notification.id)
    }
    if (notification.link) {
      onClose()
      navigate(notification.link)
    }
  }

  // Visual icons and styles based on severity
  const getSeverityConfig = (severity: NotificationSeverity) => {
    switch (severity) {
      case 'success':
        return {
          icon: <CheckCircle2 className="w-4 h-4 text-[#159B78] shrink-0" />,
          badgeBg: 'bg-[#E8F8F3] text-[#159B78] border-[#159B78]/20',
          indicatorColor: 'bg-[#159B78]',
          borderAccent: 'border-l-[#159B78]',
        }
      case 'warning':
        return {
          icon: <AlertTriangle className="w-4 h-4 text-[#E5B34B] shrink-0" />,
          badgeBg: 'bg-[#FDF8EB] text-[#B48418] border-[#E5B34B]/30',
          indicatorColor: 'bg-[#E5B34B]',
          borderAccent: 'border-l-[#E5B34B]',
        }
      case 'error':
        return {
          icon: <AlertCircle className="w-4 h-4 text-[#E76B64] shrink-0" />,
          badgeBg: 'bg-[#FDF1F0] text-[#E76B64] border-[#E76B64]/20',
          indicatorColor: 'bg-[#E76B64]',
          borderAccent: 'border-l-[#E76B64]',
        }
      case 'info':
      default:
        return {
          icon: <Info className="w-4 h-4 text-[#5277D9] shrink-0" />,
          badgeBg: 'bg-[#EAF0FF] text-[#5277D9] border-[#5277D9]/20',
          indicatorColor: 'bg-[#5277D9]',
          borderAccent: 'border-l-[#5277D9]',
        }
    }
  }

  return (
    <>
      {/* Backdrop overlay for outside click to dismiss */}
      <div
        className="fixed inset-0 z-40 bg-black/10 backdrop-blur-[0.5px]"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Dropdown Panel Container */}
      <div
        ref={panelRef}
        role="dialog"
        aria-label="In-App Notifications"
        aria-modal="true"
        className="fixed inset-x-3 top-16 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 z-50 w-auto sm:w-96 max-w-[calc(100vw-24px)] bg-white rounded-2xl shadow-2xl border border-[#E7E8EC] overflow-hidden flex flex-col max-h-[min(540px,calc(100vh-80px))] animate-fade-in text-xs text-left"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-3.5 sm:p-4 border-b border-[#E7E8EC] bg-white sticky top-0 z-10 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-[#EAF0FF] text-[#5277D9]">
                <Bell className="w-4 h-4" />
              </div>
              <h3 className="font-bold text-sm text-[#202938]">Notifications</h3>
              {unreadCount > 0 && (
                <span className="px-2 py-0.5 rounded-full text-3xs font-bold bg-[#E76B64] text-white">
                  {unreadCount} new
                </span>
              )}
            </div>

            <div className="flex items-center gap-1">
              {/* Refresh trigger */}
              <button
                type="button"
                onClick={() => refreshNotifications()}
                disabled={isLoading}
                className="p-1.5 text-[#64748B] hover:text-[#202938] hover:bg-[#F7F6F2] rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                title="Refresh notifications"
                aria-label="Refresh notifications"
              >
                <RefreshCw className={cn('w-3.5 h-3.5', isLoading && 'animate-spin text-[#5277D9]')} />
              </button>

              {/* Close panel */}
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 text-[#64748B] hover:text-[#202938] hover:bg-[#F7F6F2] rounded-lg transition-colors cursor-pointer"
                title="Close"
                aria-label="Close notifications panel"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Sub-header: Tabs & Mark all as read */}
          <div className="flex items-center justify-between gap-2 pt-1">
            <div className="flex items-center gap-1 bg-[#F7F6F2] p-0.5 rounded-lg border border-[#E7E8EC]/80">
              <button
                type="button"
                onClick={() => setFilter('all')}
                className={cn(
                  'px-2.5 py-1 rounded-md text-3xs font-semibold transition-all cursor-pointer',
                  filter === 'all'
                    ? 'bg-white text-[#202938] shadow-2xs font-bold'
                    : 'text-[#64748B] hover:text-[#202938]'
                )}
              >
                All ({notifications.length})
              </button>
              <button
                type="button"
                onClick={() => setFilter('unread')}
                className={cn(
                  'px-2.5 py-1 rounded-md text-3xs font-semibold transition-all cursor-pointer flex items-center gap-1',
                  filter === 'unread'
                    ? 'bg-white text-[#202938] shadow-2xs font-bold'
                    : 'text-[#64748B] hover:text-[#202938]'
                )}
              >
                <span>Unread</span>
                {unreadCount > 0 && (
                  <span className="w-1.5 h-1.5 rounded-full bg-[#E76B64]" />
                )}
              </button>
            </div>

            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllAsRead}
                className="inline-flex items-center gap-1 text-3xs font-semibold text-[#5277D9] hover:text-[#4366C4] hover:underline cursor-pointer transition-colors"
                title="Mark all notifications as read"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                <span>Mark all as read</span>
              </button>
            )}
          </div>
        </div>

        {/* Error Banner */}
        {error && (
          <div className="px-3 py-2 bg-[#FDF1F0] border-b border-[#E76B64]/20 text-[#E76B64] flex items-center justify-between text-2xs">
            <span className="truncate">{error}</span>
            <button
              onClick={() => refreshNotifications()}
              className="font-bold underline ml-2 shrink-0 hover:text-[#C54A43] cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}

        {/* Body / List */}
        <div className="flex-1 overflow-y-auto divide-y divide-[#E7E8EC]/60">
          {isLoading && notifications.length === 0 ? (
            /* Loading State */
            <div className="py-12 flex flex-col items-center justify-center text-center px-4">
              <RefreshCw className="w-6 h-6 text-[#5277D9] animate-spin mb-2" />
              <p className="text-xs font-medium text-[#202938]">Checking for notifications...</p>
              <p className="text-3xs text-[#64748B] mt-0.5">Fetching latest webhook delivery updates</p>
            </div>
          ) : filteredNotifications.length === 0 ? (
            /* Empty State */
            <div className="py-12 flex flex-col items-center justify-center text-center px-6">
              {filter === 'unread' ? (
                <>
                  <div className="w-10 h-10 rounded-full bg-[#E8F8F3] text-[#159B78] flex items-center justify-center mb-3">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <h4 className="text-xs font-bold text-[#202938]">All caught up!</h4>
                  <p className="text-3xs text-[#64748B] mt-1 max-w-[220px]">
                    You have no unread notifications right now.
                  </p>
                  <button
                    type="button"
                    onClick={() => setFilter('all')}
                    className="mt-3 text-3xs font-semibold text-[#5277D9] hover:underline cursor-pointer"
                  >
                    View All Notifications
                  </button>
                </>
              ) : (
                <>
                  <div className="w-10 h-10 rounded-full bg-[#F7F6F2] text-[#64748B] flex items-center justify-center mb-3">
                    <BellOff className="w-5 h-5" />
                  </div>
                  <h4 className="text-xs font-bold text-[#202938]">No notifications yet</h4>
                  <p className="text-3xs text-[#64748B] mt-1 max-w-[220px]">
                    Webhook delivery events, retries, and system alerts will appear here in real time.
                  </p>
                </>
              )}
            </div>
          ) : (
            /* Notification Items */
            filteredNotifications.map((notif) => {
              const { icon, badgeBg, borderAccent } = getSeverityConfig(notif.severity)

              return (
                <div
                  key={notif.id}
                  onClick={() => handleItemClick(notif)}
                  className={cn(
                    'p-3.5 transition-colors cursor-pointer group flex items-start gap-3 border-l-3 relative text-left',
                    borderAccent,
                    notif.read
                      ? 'bg-white hover:bg-[#F9FAFB]'
                      : 'bg-[#F9FAFB]/80 hover:bg-[#F2F4F7]'
                  )}
                >
                  {/* Left severity icon */}
                  <div className="mt-0.5 shrink-0">{icon}</div>

                  {/* Center Content */}
                  <div className="flex-1 min-w-0 pr-1">
                    <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                      <span
                        className={cn(
                          'text-xs',
                          notif.read
                            ? 'font-medium text-[#202938]'
                            : 'font-bold text-[#202938]'
                        )}
                      >
                        {notif.title}
                      </span>

                      {!notif.read && (
                        <span
                          className="w-1.5 h-1.5 rounded-full bg-[#5277D9] shrink-0"
                          title="Unread"
                        />
                      )}
                    </div>

                    <p className="text-3xs text-[#64748B] line-clamp-2 leading-relaxed">
                      {notif.description}
                    </p>

                    <div className="flex items-center gap-2 mt-2 text-3xs text-[#94A3B8]">
                      <span title={formatDateTime(notif.timestamp)}>
                        {formatRelativeTime(notif.timestamp)}
                      </span>

                      {notif.category && (
                        <>
                          <span>•</span>
                          <span
                            className={cn(
                              'px-1.5 py-0.5 rounded text-4xs font-semibold uppercase tracking-wider border',
                              badgeBg
                            )}
                          >
                            {notif.category.replace('_', ' ')}
                          </span>
                        </>
                      )}

                      {notif.link && (
                        <span className="hidden group-hover:inline-flex items-center gap-0.5 text-[#5277D9] font-medium ml-auto">
                          <span>View</span>
                          <ExternalLink className="w-2.5 h-2.5" />
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions on hover: Mark as read / Remove */}
                  <div
                    className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {!notif.read && (
                      <button
                        type="button"
                        onClick={() => markAsRead(notif.id)}
                        className="p-1 text-[#64748B] hover:text-[#5277D9] hover:bg-white rounded transition-colors cursor-pointer"
                        title="Mark as read"
                        aria-label="Mark notification as read"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => removeNotification(notif.id)}
                      className="p-1 text-[#64748B] hover:text-[#E76B64] hover:bg-white rounded transition-colors cursor-pointer"
                      title="Dismiss notification"
                      aria-label="Dismiss notification"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Footer */}
        {notifications.length > 0 && (
          <div className="p-2.5 bg-[#F7F6F2] border-t border-[#E7E8EC] flex items-center justify-between text-3xs text-[#64748B]">
            <button
              type="button"
              onClick={() => setConfirmClearOpen(true)}
              className="inline-flex items-center gap-1 text-[#64748B] hover:text-[#E76B64] transition-colors cursor-pointer"
              title="Clear all notifications"
            >
              <Trash2 className="w-3 h-3" />
              <span>Clear all</span>
            </button>

            <button
              type="button"
              onClick={() => {
                onClose()
                navigate('/deliveries')
              }}
              className="font-semibold text-[#5277D9] hover:text-[#4366C4] transition-colors cursor-pointer flex items-center gap-1"
            >
              <span>Deliveries Monitor</span>
              <ExternalLink className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      {/* Confirmation Dialog for Destructive Clear All Action */}
      <ConfirmationDialog
        isOpen={confirmClearOpen}
        onClose={() => setConfirmClearOpen(false)}
        onConfirm={() => {
          clearAll()
          setConfirmClearOpen(false)
        }}
        title="Clear All Notifications?"
        description="Are you sure you want to clear all in-app notifications? This will permanently remove your notification history."
        confirmText="Clear All"
        cancelText="Keep Notifications"
        variant="danger"
      />
    </>
  )
}
