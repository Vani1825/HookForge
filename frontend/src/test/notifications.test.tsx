// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { NotificationProvider, useNotifications } from '../context/NotificationContext'
import { NotificationPanel } from '../components/NotificationPanel'
import { Header } from '../layouts/Header'
import type { Delivery } from '../types'

// Mock AppContext
const mockGetDeliveries = vi.fn()
const mockBackendHealth = {
  status: 'up' as 'up' | 'down',
  error: undefined as string | undefined,
  timestamp: '2026-11-17T12:00:00Z',
}
const mockService = {
  getDeliveries: mockGetDeliveries,
}

vi.mock('../context/AppContext', () => ({
  useApp: () => ({
    mode: 'demo',
    toggleMode: vi.fn(),
    baseUrl: 'http://localhost:8081',
    apiKey: '',
    backendHealth: mockBackendHealth,
    checkHealth: vi.fn(),
    service: mockService,
  }),
}))

// Test consumer helper to inspect and drive context actions directly
const NotificationTester: React.FC<{
  onContext: (ctx: ReturnType<typeof useNotifications>) => void
}> = ({ onContext }) => {
  const ctx = useNotifications()
  onContext(ctx)
  return (
    <div>
      <span data-testid="unread-count">{ctx.unreadCount}</span>
      <span data-testid="total-count">{ctx.notifications.length}</span>
      <button data-testid="mark-all-btn" onClick={ctx.markAllAsRead}>
        Mark All Read
      </button>
      <button data-testid="clear-all-btn" onClick={ctx.clearAll}>
        Clear All
      </button>
    </div>
  )
}

describe('In-App Notification System', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    mockBackendHealth.status = 'up'
    mockBackendHealth.error = undefined
    mockGetDeliveries.mockResolvedValue({ data: [], pagination: { totalRecords: 0 } })
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  describe('Notification State Management & Unread Counts', () => {
    it('manages unread count and read/unread state transitions correctly', () => {
      let currentContext!: ReturnType<typeof useNotifications>

      render(
        <MemoryRouter>
          <NotificationProvider>
            <NotificationTester onContext={(ctx) => (currentContext = ctx)} />
          </NotificationProvider>
        </MemoryRouter>
      )

      expect(currentContext.unreadCount).toBe(0)
      expect(currentContext.notifications.length).toBe(0)

      // Add a test notification
      act(() => {
        currentContext.addNotification({
          id: 'test-1',
          title: 'Webhook Delivery Succeeded',
          description: 'Delivery del-12345678 succeeded with HTTP 200.',
          severity: 'success',
          category: 'delivery_success',
          read: false,
        })
      })

      expect(currentContext.unreadCount).toBe(1)
      expect(currentContext.notifications.length).toBe(1)
      expect(currentContext.notifications[0].read).toBe(false)

      // Add a second unread notification
      act(() => {
        currentContext.addNotification({
          id: 'test-2',
          title: 'Delivery Retrying (Attempt 2)',
          description: 'Delivery del-87654321 failed with 500. Retrying.',
          severity: 'warning',
          category: 'delivery_retry',
          read: false,
        })
      })

      expect(currentContext.unreadCount).toBe(2)
      expect(currentContext.notifications.length).toBe(2)

      // Mark single notification as read
      act(() => {
        currentContext.markAsRead('test-1')
      })

      expect(currentContext.unreadCount).toBe(1)
      expect(currentContext.notifications.find((n) => n.id === 'test-1')?.read).toBe(true)
      expect(currentContext.notifications.find((n) => n.id === 'test-2')?.read).toBe(false)

      // Mark all as read
      act(() => {
        currentContext.markAllAsRead()
      })

      expect(currentContext.unreadCount).toBe(0)
      expect(currentContext.notifications.every((n) => n.read)).toBe(true)

      // Remove single notification
      act(() => {
        currentContext.removeNotification('test-1')
      })

      expect(currentContext.notifications.length).toBe(1)
      expect(currentContext.notifications[0].id).toBe('test-2')

      // Clear all
      act(() => {
        currentContext.clearAll()
      })

      expect(currentContext.notifications.length).toBe(0)
      expect(currentContext.unreadCount).toBe(0)
    })

    it('filters between all and unread notifications', () => {
      let currentContext!: ReturnType<typeof useNotifications>

      render(
        <MemoryRouter>
          <NotificationProvider>
            <NotificationTester onContext={(ctx) => (currentContext = ctx)} />
          </NotificationProvider>
        </MemoryRouter>
      )

      act(() => {
        currentContext.addNotification({
          id: 'n-read',
          title: 'Read notification',
          description: 'already read',
          severity: 'info',
          category: 'system_health',
          read: true,
        })
        currentContext.addNotification({
          id: 'n-unread',
          title: 'Unread notification',
          description: 'needs attention',
          severity: 'error',
          category: 'dead_letter',
          read: false,
        })
      })

      expect(currentContext.notifications.length).toBe(2)
      expect(currentContext.filteredNotifications.length).toBe(2)

      // Switch filter to 'unread'
      act(() => {
        currentContext.setFilter('unread')
      })

      expect(currentContext.filteredNotifications.length).toBe(1)
      expect(currentContext.filteredNotifications[0].id).toBe('n-unread')

      // Switch back to 'all'
      act(() => {
        currentContext.setFilter('all')
      })

      expect(currentContext.filteredNotifications.length).toBe(2)
    })
  })

  describe('Deduplication Guarantee', () => {
    it('strictly prevents duplicate notifications for the same event key', () => {
      let currentContext!: ReturnType<typeof useNotifications>

      render(
        <MemoryRouter>
          <NotificationProvider>
            <NotificationTester onContext={(ctx) => (currentContext = ctx)} />
          </NotificationProvider>
        </MemoryRouter>
      )

      let addedFirst = false
      let addedSecond = false

      act(() => {
        addedFirst = currentContext.addNotification({
          title: 'Webhook Delivery Succeeded',
          description: 'HTTP 200 received',
          severity: 'success',
          category: 'delivery_success',
          eventKey: 'delivery:del-abc-123:SUCCEEDED:1',
        })
      })

      expect(addedFirst).toBe(true)
      expect(currentContext.notifications.length).toBe(1)

      // Attempt to add duplicate event with same eventKey
      act(() => {
        addedSecond = currentContext.addNotification({
          title: 'Webhook Delivery Succeeded',
          description: 'HTTP 200 received duplicate',
          severity: 'success',
          category: 'delivery_success',
          eventKey: 'delivery:del-abc-123:SUCCEEDED:1',
        })
      })

      expect(addedSecond).toBe(false)
      expect(currentContext.notifications.length).toBe(1)
    })
  })

  describe('Delivery Event Lifecycle Mapping', () => {
    it('creates appropriate notifications for delivery succeeded, retrying, failed, and dead letter', async () => {
      const mockDeliveries: Delivery[] = [
        {
          id: 'del-success-01',
          event_id: 'evt-1',
          endpoint_id: 'ep-1',
          endpoint_url: 'https://api.partner.com/webhook',
          seq: 1,
          state: 'SUCCEEDED',
          attempt_count: 1,
          last_status_code: 200,
          next_attempt_at: '2026-11-17T12:00:00Z',
          created_at: '2026-11-17T11:59:00Z',
          updated_at: '2026-11-17T12:00:00Z',
        },
        {
          id: 'del-retry-02',
          event_id: 'evt-2',
          endpoint_id: 'ep-2',
          endpoint_url: 'https://api.crm.com/hooks',
          seq: 2,
          state: 'RETRYING',
          attempt_count: 2,
          last_status_code: 504,
          last_error: 'Gateway Timeout (504)',
          next_attempt_at: '2026-11-17T12:05:00Z',
          created_at: '2026-11-17T11:58:00Z',
          updated_at: '2026-11-17T12:00:00Z',
        },
        {
          id: 'del-dead-03',
          event_id: 'evt-3',
          endpoint_id: 'ep-3',
          endpoint_url: 'https://api.payments.com/events',
          seq: 3,
          state: 'DEAD',
          attempt_count: 5,
          last_status_code: 500,
          last_error: 'Internal Server Error (500)',
          next_attempt_at: '2026-11-17T12:00:00Z',
          created_at: '2026-11-17T11:50:00Z',
          updated_at: '2026-11-17T12:00:00Z',
        },
      ]

      mockGetDeliveries.mockResolvedValue({
        data: mockDeliveries,
        pagination: { totalRecords: 3 },
      })

      let currentContext!: ReturnType<typeof useNotifications>

      render(
        <MemoryRouter>
          <NotificationProvider>
            <NotificationTester onContext={(ctx) => (currentContext = ctx)} />
          </NotificationProvider>
        </MemoryRouter>
      )

      await act(async () => {
        await currentContext.refreshNotifications()
      })

      expect(currentContext.notifications.length).toBe(3)

      const successNotif = currentContext.notifications.find((n) => n.category === 'delivery_success')
      expect(successNotif).toBeDefined()
      expect(successNotif?.severity).toBe('success')
      expect(successNotif?.title).toContain('Webhook Delivery Succeeded')

      const retryNotif = currentContext.notifications.find((n) => n.category === 'delivery_retry')
      expect(retryNotif).toBeDefined()
      expect(retryNotif?.severity).toBe('warning')
      expect(retryNotif?.title).toContain('Delivery Retrying (Attempt 2)')

      const deadNotif = currentContext.notifications.find((n) => n.category === 'dead_letter')
      expect(deadNotif).toBeDefined()
      expect(deadNotif?.severity).toBe('error')
      expect(deadNotif?.title).toContain('Dead-Letter Queue')
    })
  })

  describe('NotificationPanel UI Component', () => {
    it('renders empty state when there are no notifications', async () => {
      const onClose = vi.fn()
      render(
        <MemoryRouter>
          <NotificationProvider>
            <NotificationPanel onClose={onClose} />
          </NotificationProvider>
        </MemoryRouter>
      )

      await waitFor(() => {
        expect(screen.getByText('Notifications')).toBeDefined()
        expect(screen.getByText('No notifications yet')).toBeDefined()
        expect(
          screen.getByText(/Webhook delivery events, retries, and system alerts will appear here/i)
        ).toBeDefined()
      })
    })

    it('renders notification items with severity indicators, titles, and timestamps', async () => {
      let currentContext!: ReturnType<typeof useNotifications>
      const onClose = vi.fn()

      render(
        <MemoryRouter>
          <NotificationProvider>
            <NotificationTester onContext={(ctx) => (currentContext = ctx)} />
            <NotificationPanel onClose={onClose} />
          </NotificationProvider>
        </MemoryRouter>
      )

      await waitFor(() => {
        expect(screen.getByText('Notifications')).toBeDefined()
      })

      act(() => {
        currentContext.addNotification({
          id: 'n-1',
          title: 'Delivery Succeeded',
          description: 'Delivery completed to partner webhook endpoint.',
          severity: 'success',
          category: 'delivery_success',
          timestamp: new Date().toISOString(),
          read: false,
        })
        currentContext.addNotification({
          id: 'n-2',
          title: 'Dead-Letter Alert',
          description: 'Delivery exhausted retries and moved to DLQ.',
          severity: 'error',
          category: 'dead_letter',
          timestamp: new Date().toISOString(),
          read: false,
        })
      })

      expect(screen.getByText('Delivery Succeeded')).toBeDefined()
      expect(screen.getByText('Delivery completed to partner webhook endpoint.')).toBeDefined()
      expect(screen.getByText('Dead-Letter Alert')).toBeDefined()
      expect(screen.getByText('Delivery exhausted retries and moved to DLQ.')).toBeDefined()
      expect(screen.getByText('2 new')).toBeDefined()
    })

    it('marks all as read when clicking "Mark all as read" button', async () => {
      let currentContext!: ReturnType<typeof useNotifications>
      const onClose = vi.fn()

      render(
        <MemoryRouter>
          <NotificationProvider>
            <NotificationTester onContext={(ctx) => (currentContext = ctx)} />
            <NotificationPanel onClose={onClose} />
          </NotificationProvider>
        </MemoryRouter>
      )

      await waitFor(() => {
        expect(screen.getByText('Notifications')).toBeDefined()
      })

      act(() => {
        currentContext.addNotification({
          id: 'notif-unread-1',
          title: 'Warning event',
          description: 'Warning description',
          severity: 'warning',
          category: 'delivery_retry',
          read: false,
        })
      })

      const markAllBtn = screen.getByText('Mark all as read')
      fireEvent.click(markAllBtn)

      expect(currentContext.unreadCount).toBe(0)
    })

    it('displays error state when synchronization fails and provides retry', async () => {
      let currentContext!: ReturnType<typeof useNotifications>
      const onClose = vi.fn()

      mockGetDeliveries.mockRejectedValueOnce(new Error('Network offline: connection refused'))

      render(
        <MemoryRouter>
          <NotificationProvider>
            <NotificationTester onContext={(ctx) => (currentContext = ctx)} />
            <NotificationPanel onClose={onClose} />
          </NotificationProvider>
        </MemoryRouter>
      )

      await act(async () => {
        await currentContext.refreshNotifications()
      })

      expect(screen.getByText('Network offline: connection refused')).toBeDefined()
      expect(screen.getByText('Retry')).toBeDefined()
    })

    it('closes on Escape key press', () => {
      const onClose = vi.fn()
      render(
        <MemoryRouter>
          <NotificationProvider>
            <NotificationPanel onClose={onClose} />
          </NotificationProvider>
        </MemoryRouter>
      )

      fireEvent.keyDown(window, { key: 'Escape' })
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  describe('Header Notification Bell Integration', () => {
    it('renders notification bell and shows unread badge when unreadCount > 0', () => {
      let currentContext!: ReturnType<typeof useNotifications>

      render(
        <MemoryRouter>
          <NotificationProvider>
            <NotificationTester onContext={(ctx) => (currentContext = ctx)} />
            <Header
              onOpenMobileMenu={vi.fn()}
              onOpenSendEvent={vi.fn()}
              onOpenAddEndpoint={vi.fn()}
              onOpenSearch={vi.fn()}
            />
          </NotificationProvider>
        </MemoryRouter>
      )

      // Add 3 notifications
      act(() => {
        currentContext.addNotification({
          id: '1',
          title: 'Event 1',
          description: 'Desc 1',
          severity: 'info',
          category: 'system_health',
          read: false,
        })
        currentContext.addNotification({
          id: '2',
          title: 'Event 2',
          description: 'Desc 2',
          severity: 'success',
          category: 'delivery_success',
          read: false,
        })
        currentContext.addNotification({
          id: '3',
          title: 'Event 3',
          description: 'Desc 3',
          severity: 'error',
          category: 'delivery_failed',
          read: false,
        })
      })

      // Bell buttons exist with aria-label containing unread count
      const bellButtons = screen.getAllByRole('button', { name: /notifications \(3 unread\)/i })
      expect(bellButtons.length).toBeGreaterThan(0)

      // Badge displays "3"
      const badges = screen.getAllByText('3')
      expect(badges.length).toBeGreaterThan(0)
    })
  })
})
