import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react'
import type { AppNotification, NotificationSeverity, NotificationCategory, Delivery } from '../types'
import { useApp } from './AppContext'
import { truncateId } from '../utils/formatters'

export type NotificationFilter = 'all' | 'unread'

export interface AddNotificationInput {
  id?: string
  title: string
  description: string
  timestamp?: string
  severity: NotificationSeverity
  category: NotificationCategory
  read?: boolean
  entityId?: string
  link?: string
  metadata?: Record<string, unknown>
  eventKey?: string
}

export interface NotificationContextValue {
  notifications: AppNotification[]
  unreadCount: number
  filter: NotificationFilter
  setFilter: (filter: NotificationFilter) => void
  filteredNotifications: AppNotification[]
  markAsRead: (id: string) => void
  markAllAsRead: () => void
  removeNotification: (id: string) => void
  clearAll: () => void
  isPanelOpen: boolean
  setIsPanelOpen: (open: boolean) => void
  togglePanel: () => void
  isLoading: boolean
  error: string | null
  refreshNotifications: () => Promise<void>
  addNotification: (input: AddNotificationInput) => boolean
}

const NotificationContext = createContext<NotificationContextValue | undefined>(undefined)

const STORAGE_KEY_NOTIFICATIONS = 'hookforge_in_app_notifications'
const STORAGE_KEY_SEEN_KEYS = 'hookforge_seen_notification_keys'
const MAX_NOTIFICATIONS_STORED = 100

export const NotificationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { service, backendHealth, mode } = useApp()

  // State
  const [notifications, setNotifications] = useState<AppNotification[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_NOTIFICATIONS)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed)) return parsed
      }
    } catch (e) {
      console.warn('Failed to parse notifications from localStorage', e)
    }
    return []
  })

  // Set of seen event keys to strictly avoid duplicate notifications for the same event
  const [seenKeys, setSeenKeys] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_SEEN_KEYS)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed)) return new Set(parsed)
      }
    } catch (e) {
      console.warn('Failed to parse seen keys from localStorage', e)
    }
    return new Set<string>()
  })

  const seenKeysRef = useRef<Set<string>>(seenKeys)
  useEffect(() => {
    seenKeysRef.current = seenKeys
  }, [seenKeys])

  const isInitialSeedRef = useRef(true)

  const [filter, setFilter] = useState<NotificationFilter>('all')
  const [isPanelOpen, setIsPanelOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Sync state to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_NOTIFICATIONS, JSON.stringify(notifications))
    } catch (e) {
      console.warn('Failed to save notifications to localStorage', e)
    }
  }, [notifications])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_SEEN_KEYS, JSON.stringify(Array.from(seenKeys)))
    } catch (e) {
      console.warn('Failed to save seen notification keys to localStorage', e)
    }
  }, [seenKeys])

  // Unread count
  const unreadCount = notifications.filter((n) => !n.read).length

  // Filtered notifications
  const filteredNotifications =
    filter === 'unread' ? notifications.filter((n) => !n.read) : notifications

  // Mark single notification as read
  const markAsRead = useCallback((id: string) => {
    setNotifications((prev) =>
      prev.map((notif) => (notif.id === id ? { ...notif, read: true } : notif))
    )
  }, [])

  // Mark all notifications as read
  const markAllAsRead = useCallback(() => {
    setNotifications((prev) => prev.map((notif) => ({ ...notif, read: true })))
  }, [])

  // Remove single notification
  const removeNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((notif) => notif.id !== id))
  }, [])

  // Clear all notifications
  const clearAll = useCallback(() => {
    setNotifications([])
  }, [])

  // Toggle dropdown panel
  const togglePanel = useCallback(() => {
    setIsPanelOpen((prev) => !prev)
  }, [])

  // Add notification with deduplication key check
  const addNotification = useCallback((input: AddNotificationInput): boolean => {
    if (input.eventKey && seenKeysRef.current.has(input.eventKey)) {
      // Event already recorded, deduplicate!
      return false
    }

    const newNotif: AppNotification = {
      id: input.id || `notif-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      title: input.title,
      description: input.description,
      timestamp: input.timestamp || new Date().toISOString(),
      severity: input.severity,
      category: input.category,
      read: input.read ?? false,
      entityId: input.entityId,
      link: input.link,
      metadata: input.metadata,
    }

    setNotifications((prev) => [newNotif, ...prev.slice(0, MAX_NOTIFICATIONS_STORED - 1)])

    if (input.eventKey) {
      seenKeysRef.current.add(input.eventKey)
      setSeenKeys(new Set(seenKeysRef.current))
    }

    return true
  }, [])

  // Process a list of deliveries into notifications with strict deduplication
  const processDeliveries = useCallback((deliveries: Delivery[]) => {
    const newItems: AppNotification[] = []
    const currentSeen = seenKeysRef.current
    const newSeen = new Set(currentSeen)
    let addedCount = 0
    const isInitialSeed = isInitialSeedRef.current && currentSeen.size === 0

    for (const d of deliveries) {
      let key: string | null = null
      let title = ''
      let description = ''
      let severity: NotificationSeverity = 'info'
      let category: NotificationCategory = 'delivery_success'
      let link = '/deliveries'

      const url = d.endpoint_url || d.endpoint?.url || 'target endpoint'
      const shortId = truncateId(d.id, 8)

      if (d.state === 'DEAD') {
        key = `delivery:${d.id}:DEAD:${d.attempt_count}`
        if (!newSeen.has(key)) {
          newSeen.add(key)
          title = 'Delivery Moved to Dead-Letter Queue'
          description = `Delivery ${shortId} to ${url} exhausted all ${d.attempt_count} retries. Moved to DLQ.`
          severity = 'error'
          category = 'dead_letter'
          link = '/dead-letters'
        }
      } else if (d.state === 'RETRYING') {
        key = `delivery:${d.id}:RETRYING:${d.attempt_count}`
        if (!newSeen.has(key)) {
          newSeen.add(key)
          title = `Delivery Retrying (Attempt ${d.attempt_count})`
          description = `Delivery ${shortId} to ${url} attempt ${d.attempt_count} failed (${d.last_error || (d.last_status_code ? 'HTTP ' + d.last_status_code : 'Connection error')}). Retry scheduled.`
          severity = 'warning'
          category = 'delivery_retry'
          link = '/deliveries'
        }
      } else if (d.state === 'SUCCEEDED') {
        key = `delivery:${d.id}:SUCCEEDED:${d.attempt_count}`
        if (!newSeen.has(key)) {
          newSeen.add(key)
          title = 'Webhook Delivery Succeeded'
          description = `Delivery ${shortId} to ${url} completed successfully (HTTP ${d.last_status_code || 200}).`
          severity = 'success'
          category = 'delivery_success'
          link = '/deliveries'
        }
      } else if (d.last_status_code && d.last_status_code >= 400) {
        key = `delivery:${d.id}:FAILED:${d.attempt_count}`
        if (!newSeen.has(key)) {
          newSeen.add(key)
          title = 'Webhook Delivery Failed'
          description = `Delivery ${shortId} to ${url} returned error HTTP ${d.last_status_code}.`
          severity = 'error'
          category = 'delivery_failed'
          link = '/deliveries'
        }
      }

      if (key && title) {
        // If this is initial seeding and we already have more than 4 items, mark older ones as seen without flooding notifications
        if (isInitialSeed && addedCount >= 4) {
          continue
        }

        newItems.push({
          id: `notif-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          title,
          description,
          timestamp: d.updated_at || d.created_at || new Date().toISOString(),
          severity,
          category,
          read: false,
          entityId: d.id,
          link,
          metadata: {
            endpointUrl: url,
            statusCode: d.last_status_code,
            attemptCount: d.attempt_count,
            error: d.last_error,
          },
        })
        addedCount++
      }
    }

    isInitialSeedRef.current = false

    if (newItems.length > 0) {
      seenKeysRef.current = newSeen
      setSeenKeys(newSeen)
      setNotifications((prev) => [
        ...newItems,
        ...prev.slice(0, MAX_NOTIFICATIONS_STORED - newItems.length),
      ])
    }
  }, [])

  // Fetch deliveries and update notifications
  const refreshNotifications = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await service.getDeliveries({ limit: 40, page: 1 })
      const items = res?.data || (Array.isArray(res) ? res : [])
      processDeliveries(items)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to synchronize notifications'
      setError(msg)
    } finally {
      setIsLoading(false)
    }
  }, [service, processDeliveries])

  // Track system health transitions (Connection lost / restored)
  const prevHealthStatusRef = useRef<string | null>(null)
  useEffect(() => {
    const current = backendHealth.status
    if (prevHealthStatusRef.current === null) {
      prevHealthStatusRef.current = current
      // If initially down on startup in live mode
      if (mode === 'live' && current === 'down') {
        const key = `health:down:init:${backendHealth.timestamp || 'initial'}`
        addNotification({
          title: 'Backend Connection Problem',
          description: backendHealth.error || 'Unable to connect to HookForge server.',
          severity: 'error',
          category: 'system_health',
          link: '/settings',
          eventKey: key,
        })
      }
      return
    }

    if (prevHealthStatusRef.current !== current) {
      const prev = prevHealthStatusRef.current
      prevHealthStatusRef.current = current

      if (current === 'down') {
        const key = `health:down:${backendHealth.timestamp || Date.now()}`
        addNotification({
          title: 'Backend Connection Problem',
          description: backendHealth.error || 'Lost connection to HookForge backend server.',
          severity: 'error',
          category: 'system_health',
          link: '/settings',
          eventKey: key,
        })
      } else if (current === 'up' && prev === 'down') {
        const key = `health:up:${backendHealth.timestamp || Date.now()}`
        addNotification({
          title: 'Backend Connection Restored',
          description: 'Successfully reconnected to HookForge server.',
          severity: 'info',
          category: 'system_health',
          eventKey: key,
        })
      }
    }
  }, [backendHealth, mode, addNotification])

  // Ref to refreshNotifications so interval doesn't re-trigger on re-renders
  const refreshNotificationsRef = useRef(refreshNotifications)
  useEffect(() => {
    refreshNotificationsRef.current = refreshNotifications
  }, [refreshNotifications])

  // Initial fetch and periodic background sync (every 10 seconds)
  useEffect(() => {
    refreshNotificationsRef.current()

    const interval = setInterval(() => {
      refreshNotificationsRef.current()
    }, 10000)

    const handleFocus = () => {
      refreshNotificationsRef.current()
    }
    window.addEventListener('focus', handleFocus)

    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', handleFocus)
    }
  }, [])

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        filter,
        setFilter,
        filteredNotifications,
        markAsRead,
        markAllAsRead,
        removeNotification,
        clearAll,
        isPanelOpen,
        setIsPanelOpen,
        togglePanel,
        isLoading,
        error,
        refreshNotifications,
        addNotification,
      }}
    >
      {children}
    </NotificationContext.Provider>
  )
}

const defaultNotificationContext: NotificationContextValue = {
  notifications: [],
  unreadCount: 0,
  filter: 'all',
  setFilter: () => {},
  filteredNotifications: [],
  markAsRead: () => {},
  markAllAsRead: () => {},
  removeNotification: () => {},
  clearAll: () => {},
  isPanelOpen: false,
  setIsPanelOpen: () => {},
  togglePanel: () => {},
  isLoading: false,
  error: null,
  refreshNotifications: async () => {},
  addNotification: () => false,
}

export const useNotifications = (): NotificationContextValue => {
  const context = useContext(NotificationContext)
  if (!context) {
    return defaultNotificationContext
  }
  return context
}
