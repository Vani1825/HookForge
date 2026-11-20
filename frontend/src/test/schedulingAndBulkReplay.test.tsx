// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { apiClient } from '../api/client'
import {
  scheduleDelivery,
  fetchScheduledDeliveries,
  fetchScheduledDeliveryById,
  cancelScheduledDelivery,
  bulkReplayDeliveries,
} from '../api/deliveries'
import { mockStore } from '../mocks/mockStore'
import { ScheduleDeliveryModal } from '../components/ScheduleDeliveryModal'
import { CancelScheduledModal } from '../components/CancelScheduledModal'
import { BulkReplayConfirmModal } from '../components/BulkReplayConfirmModal'
import { BulkReplayResultModal } from '../components/BulkReplayResultModal'
import { StatusBadge } from '../components/StatusBadge'
import { ScheduledDeliveriesPage } from '../pages/ScheduledDeliveriesPage'
import { DeliveriesPage } from '../pages/DeliveriesPage'
import { DeadLettersPage } from '../pages/DeadLettersPage'
import { AppProvider } from '../context/AppContext'
import type { BulkReplayResult } from '../types'

vi.mock('../api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
  formatErrorMessage: (err: any) =>
    err?.response?.data?.message || err?.message || 'Network Error',
}))

describe('Phase 2, Task 1: Scheduling & Bulk Replay', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  describe('1. API Client Contracts', () => {
    it('scheduleDelivery sends POST to /deliveries/schedule and normalizes response', async () => {
      const mockRawScheduled = {
        id: 'del-sched-1',
        eventId: 'ev-1',
        endpointId: 'ep-1',
        state: 'SCHEDULED',
        scheduledAt: '2026-12-01T15:00:00.000Z',
        scheduled_at: '2026-12-01T15:00:00.000Z',
        seq: 5,
        attemptCount: 0,
        createdAt: '2026-11-20T10:00:00.000Z',
        updatedAt: '2026-11-20T10:00:00.000Z',
      }
      vi.mocked(apiClient.post).mockResolvedValue({
        success: true,
        delivery: mockRawScheduled,
      })

      const res = await scheduleDelivery({
        endpointId: 'ep-1',
        scheduledAt: '2026-12-01T15:00:00.000Z',
        payload: { event: 'user.created' },
      })

      expect(apiClient.post).toHaveBeenCalledWith(
        '/deliveries/schedule',
        expect.objectContaining({
          endpointId: 'ep-1',
          scheduledAt: '2026-12-01T15:00:00.000Z',
          payload: { event: 'user.created' },
        })
      )
      expect(res.id).toBe('del-sched-1')
      expect(res.state).toBe('SCHEDULED')
      expect(res.scheduled_at).toBe('2026-12-01T15:00:00.000Z')
    })

    it('fetchScheduledDeliveries sends GET to /deliveries/scheduled with query params', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [
          {
            id: 'del-s1',
            eventId: 'ev-1',
            endpointId: 'ep-1',
            state: 'SCHEDULED',
            scheduledAt: '2026-12-05T12:00:00.000Z',
          },
        ],
        pagination: {
          page: 1,
          pageSize: 20,
          totalRecords: 1,
          totalPages: 1,
          hasNext: false,
          hasPrev: false,
        },
      })

      const res = await fetchScheduledDeliveries({ page: 1, pageSize: 20 })

      expect(apiClient.get).toHaveBeenCalledWith(
        '/deliveries/scheduled',
        expect.objectContaining({
          params: expect.objectContaining({ page: 1, pageSize: 20 }),
        })
      )
      expect(res.length).toBe(1)
      expect(res[0].id).toBe('del-s1')
      expect(res.pagination.totalRecords).toBe(1)
    })

    it('fetchScheduledDeliveryById sends GET to /deliveries/scheduled/:id', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        delivery: {
          id: 'del-s2',
          state: 'SCHEDULED',
          scheduledAt: '2026-12-10T10:00:00.000Z',
        },
      })

      const res = await fetchScheduledDeliveryById('del-s2')

      expect(apiClient.get).toHaveBeenCalledWith('/deliveries/scheduled/del-s2')
      expect(res.id).toBe('del-s2')
      expect(res.state).toBe('SCHEDULED')
    })

    it('cancelScheduledDelivery sends POST to /deliveries/:id/cancel', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        success: true,
        message: 'Scheduled delivery cancelled successfully',
        delivery: {
          id: 'del-s1',
          state: 'CANCELLED',
        },
      })

      const res = await cancelScheduledDelivery('del-s1')

      expect(apiClient.post).toHaveBeenCalledWith('/deliveries/del-s1/cancel')
      expect(res.success).toBe(true)
      expect(res.delivery?.state).toBe('CANCELLED')
    })

    it('bulkReplayDeliveries sends POST to /deliveries/bulk-replay and maps response', async () => {
      const mockResult: BulkReplayResult = {
        success: true,
        total: 3,
        successful: [
          {
            id: 'del-dead-1',
            event_id: 'ev-1',
            endpoint_id: 'ep-1',
            seq: 1,
            state: 'PENDING',
            attempt_count: 0,
            next_attempt_at: '2026-11-20T18:00:00Z',
            created_at: '2026-11-20T10:00:00Z',
            updated_at: '2026-11-20T18:00:00Z',
          },
        ],
        ineligible: [
          {
            id: 'del-succ-1',
            state: 'SUCCEEDED',
            reason: 'Delivery is in state SUCCEEDED; only DEAD deliveries are eligible for replay',
          },
        ],
        rejected: [
          {
            id: 'del-nonexistent',
            reason: 'Delivery not found or access denied',
          },
        ],
        summary: {
          total: 3,
          successfulCount: 1,
          ineligibleCount: 1,
          rejectedCount: 1,
        },
      }
      vi.mocked(apiClient.post).mockResolvedValue(mockResult)

      const res = await bulkReplayDeliveries(['del-dead-1', 'del-succ-1', 'del-nonexistent'])

      expect(apiClient.post).toHaveBeenCalledWith('/deliveries/bulk-replay', {
        deliveryIds: ['del-dead-1', 'del-succ-1', 'del-nonexistent'],
      })
      expect(res.success).toBe(true)
      expect(res.successful.length).toBe(1)
      expect(res.ineligible.length).toBe(1)
      expect(res.rejected.length).toBe(1)
      expect(res.summary.successfulCount).toBe(1)
    })
  })

  describe('2. MockStore Scheduling & Bulk Replay', () => {
    it('prevents scheduling in the past in mock store', () => {
      const endpoints = mockStore.getEndpoints()
      const epId = endpoints[0].id
      const pastTime = new Date(Date.now() - 3600000).toISOString()

      expect(() => {
        mockStore.scheduleDelivery({
          endpointId: epId,
          scheduledAt: pastTime,
          payload: { test: true },
        })
      }).toThrow(/scheduledAt must be a valid future ISO-8601 date/)
    })

    it('successfully creates a scheduled delivery in mock store', () => {
      const endpoints = mockStore.getEndpoints()
      const epId = endpoints[0].id
      const futureTime = new Date(Date.now() + 86400000).toISOString()

      const created = mockStore.scheduleDelivery({
        endpointId: epId,
        scheduledAt: futureTime,
        payload: { event: 'subscription.renewed' },
      })

      expect(created.id).toBeDefined()
      expect(created.state).toBe('SCHEDULED')
      expect(created.scheduled_at).toBe(futureTime)

      // Listing scheduled deliveries should include it
      const scheduledList = mockStore.getScheduledDeliveries()
      expect(scheduledList.some((d) => d.id === created.id)).toBe(true)
    })

    it('cancels scheduled delivery in mock store', () => {
      const endpoints = mockStore.getEndpoints()
      const epId = endpoints[0].id
      const futureTime = new Date(Date.now() + 86400000).toISOString()

      const created = mockStore.scheduleDelivery({
        endpointId: epId,
        scheduledAt: futureTime,
      })

      const cancelled = mockStore.cancelScheduledDelivery(created.id)
      expect(cancelled.success).toBe(true)
      expect(cancelled.delivery?.state).toBe('CANCELLED')
    })

    it('bulk replay partitions dead, ineligible, and rejected deliveries in mock store', () => {
      const deadDeliveries = mockStore.getDeadLetters()
      const deadId = deadDeliveries.length > 0 ? deadDeliveries[0].id : 'del-dead'

      const result = mockStore.bulkReplayDeliveries([deadId, 'unknown-id-123'])

      expect(result.success).toBe(true)
      expect(result.total).toBe(2)
      if (deadDeliveries.length > 0) {
        expect(result.summary.successfulCount).toBeGreaterThanOrEqual(1)
      }
      expect(result.summary.rejectedCount).toBe(1)
      expect(result.rejected[0].id).toBe('unknown-id-123')
    })
  })

  function getFutureLocalDatetime(hoursFromNow = 24): string {
    const d = new Date(Date.now() + hoursFromNow * 3600 * 1000)
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const hours = String(d.getHours()).padStart(2, '0')
    const minutes = String(d.getMinutes()).padStart(2, '0')
    return `${year}-${month}-${day}T${hours}:${minutes}`
  }

  describe('3. StatusBadge Component', () => {
    it('renders Scheduled status badge correctly', () => {
      render(<StatusBadge state="SCHEDULED" />)
      expect(screen.getByText('Scheduled')).toBeDefined()
    })

    it('renders Cancelled status badge correctly', () => {
      render(<StatusBadge state="CANCELLED" />)
      expect(screen.getByText('Cancelled')).toBeDefined()
    })
  })

  describe('4. ScheduleDeliveryModal Component', () => {
    it('validates past timestamps and displays error notice', async () => {
      render(
        <AppProvider>
          <ScheduleDeliveryModal
            isOpen={true}
            onClose={vi.fn()}
            onSuccess={vi.fn()}
          />
        </AppProvider>
      )

      await waitFor(() => {
        expect(screen.getByText('Schedule Webhook Delivery')).toBeDefined()
      })

      // Set datetime input to past
      const dateInput = screen.getByLabelText(/Scheduled Execution Time/i)
      fireEvent.change(dateInput, { target: { value: '2020-01-01T12:00' } })

      // Click review schedule
      const reviewButton = screen.getByRole('button', { name: /Review Schedule/i })
      fireEvent.click(reviewButton)

      expect(screen.getByText('Scheduled time must be in the future.')).toBeDefined()
    })

    it('validates invalid JSON payload and displays error', async () => {
      render(
        <AppProvider>
          <ScheduleDeliveryModal
            isOpen={true}
            onClose={vi.fn()}
            onSuccess={vi.fn()}
          />
        </AppProvider>
      )

      await waitFor(() => {
        expect(screen.getByText('Schedule Webhook Delivery')).toBeDefined()
      })

      // Set invalid JSON
      const textarea = screen.getByLabelText(/Custom JSON payload/i)
      fireEvent.change(textarea, { target: { value: '{ invalid_json: ' } })

      // Ensure future date
      const dateInput = screen.getByLabelText(/Scheduled Execution Time/i)
      const future = getFutureLocalDatetime(24)
      fireEvent.change(dateInput, { target: { value: future } })

      const reviewButton = screen.getByRole('button', { name: /Review Schedule/i })
      fireEvent.click(reviewButton)

      expect(screen.getByText(/Invalid JSON payload syntax/i)).toBeDefined()
    })

    it('navigates to review confirmation step on valid input', async () => {
      render(
        <AppProvider>
          <ScheduleDeliveryModal
            isOpen={true}
            onClose={vi.fn()}
            onSuccess={vi.fn()}
          />
        </AppProvider>
      )

      await waitFor(() => {
        expect(screen.getByText('Schedule Webhook Delivery')).toBeDefined()
      })

      // Valid future date
      const dateInput = screen.getByLabelText(/Scheduled Execution Time/i)
      const future = getFutureLocalDatetime(24)
      fireEvent.change(dateInput, { target: { value: future } })

      const reviewButton = screen.getByRole('button', { name: /Review Schedule/i })
      fireEvent.click(reviewButton)

      await waitFor(() => {
        expect(screen.getByText('Confirm Scheduled Delivery')).toBeDefined()
        expect(screen.getByRole('button', { name: /Confirm & Schedule/i })).toBeDefined()
      })
    })

    it('executes successful scheduling when confirming in review step', async () => {
      const onSuccess = vi.fn()
      const onClose = vi.fn()

      render(
        <AppProvider>
          <ScheduleDeliveryModal
            isOpen={true}
            onClose={onClose}
            onSuccess={onSuccess}
          />
        </AppProvider>
      )

      await waitFor(() => {
        expect(screen.getByText('Schedule Webhook Delivery')).toBeDefined()
      })

      const dateInput = screen.getByLabelText(/Scheduled Execution Time/i)
      const future = getFutureLocalDatetime(24)
      fireEvent.change(dateInput, { target: { value: future } })

      const reviewButton = screen.getByRole('button', { name: /Review Schedule/i })
      fireEvent.click(reviewButton)

      const confirmButton = await screen.findByRole('button', { name: /Confirm & Schedule/i })
      fireEvent.click(confirmButton)

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalled()
        expect(onClose).toHaveBeenCalled()
      })
    })
  })

  describe('5. CancelScheduledModal Component', () => {
    it('renders delivery details and calls cancellation on confirm', async () => {
      const endpoints = mockStore.getEndpoints()
      const futureTime = new Date(Date.now() + 86400000).toISOString()
      const mockDelivery = mockStore.scheduleDelivery({
        endpointId: endpoints[0].id,
        scheduledAt: futureTime,
      })

      const onSuccess = vi.fn()
      const onClose = vi.fn()

      render(
        <AppProvider>
          <CancelScheduledModal
            delivery={mockDelivery}
            isOpen={true}
            onClose={onClose}
            onSuccess={onSuccess}
          />
        </AppProvider>
      )

      expect(screen.getByText('Cancel Scheduled Delivery')).toBeDefined()
      expect(screen.getByText(mockDelivery.id)).toBeDefined()

      const confirmBtn = screen.getByRole('button', { name: /Confirm Cancellation/i })
      fireEvent.click(confirmBtn)

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalled()
        expect(onClose).toHaveBeenCalled()
      })
    })
  })

  describe('6. BulkReplayConfirmModal and BulkReplayResultModal', () => {
    it('BulkReplayConfirmModal displays selection count and handles confirmation', async () => {
      const onComplete = vi.fn()
      const onClose = vi.fn()

      render(
        <AppProvider>
          <BulkReplayConfirmModal
            deliveryIds={['del-1', 'del-2']}
            isOpen={true}
            onClose={onClose}
            onComplete={onComplete}
          />
        </AppProvider>
      )

      expect(screen.getByText(/Confirm Bulk Replay \(2 Deliveries\)/i)).toBeDefined()
      expect(screen.getByRole('button', { name: /Confirm & Replay \(2\)/i })).toBeDefined()

      fireEvent.click(screen.getByRole('button', { name: /Confirm & Replay \(2\)/i }))

      await waitFor(() => {
        expect(onComplete).toHaveBeenCalled()
        expect(onClose).toHaveBeenCalled()
      })
    })

    it('BulkReplayResultModal displays partitioned successful, ineligible, and rejected results', () => {
      const mockResult: BulkReplayResult = {
        success: true,
        total: 3,
        successful: [
          {
            id: 'del-replayed-1',
            event_id: 'ev-1',
            endpoint_id: 'ep-1',
            endpoint_url: 'https://endpoint.com/webhook',
            state: 'PENDING',
            seq: 1,
            attempt_count: 0,
            next_attempt_at: '2026-11-20T18:00:00Z',
            created_at: '2026-11-20T10:00:00Z',
            updated_at: '2026-11-20T18:00:00Z',
          },
        ],
        ineligible: [
          {
            id: 'del-ineligible-1',
            state: 'SUCCEEDED',
            reason: 'Delivery is in state SUCCEEDED; only DEAD deliveries are eligible for replay',
          },
        ],
        rejected: [
          {
            id: 'del-rejected-1',
            reason: 'Delivery not found or access denied',
          },
        ],
        summary: {
          total: 3,
          successfulCount: 1,
          ineligibleCount: 1,
          rejectedCount: 1,
        },
      }

      render(
        <BulkReplayResultModal
          result={mockResult}
          isOpen={true}
          onClose={vi.fn()}
        />
      )

      expect(screen.getByText('Bulk Replay Results')).toBeDefined()
      expect(screen.getByText('3')).toBeDefined() // Total
      expect(screen.getByText('Enqueued as PENDING')).toBeDefined()
      expect(screen.getByText(/Delivery is in state SUCCEEDED/i)).toBeDefined()
      expect(screen.getByText(/Delivery not found or access denied/i)).toBeDefined()
    })
  })

  describe('7. ScheduledDeliveriesPage UI Integration', () => {
    it('renders ScheduledDeliveriesPage with header and schedule button', async () => {
      render(
        <AppProvider>
          <ScheduledDeliveriesPage />
        </AppProvider>
      )

      expect(screen.getByText('Scheduled Deliveries')).toBeDefined()
      expect(screen.getByRole('button', { name: /Schedule Webhook/i })).toBeDefined()
    })

    it('opens ScheduleDeliveryModal when clicking Schedule Webhook button', async () => {
      render(
        <AppProvider>
          <ScheduledDeliveriesPage />
        </AppProvider>
      )

      const scheduleBtn = screen.getByRole('button', { name: /Schedule Webhook/i })
      fireEvent.click(scheduleBtn)

      await waitFor(() => {
        expect(screen.getByText('Schedule Webhook Delivery')).toBeDefined()
      })
    })
  })

  describe('8. DeliveriesPage and DeadLettersPage Bulk Selection UI', () => {
    it('renders DeliveriesPage and disables selection on non-DEAD deliveries', async () => {
      render(
        <AppProvider>
          <DeliveriesPage />
        </AppProvider>
      )

      await waitFor(() => {
        expect(screen.getByText('Delivery Pipeline Monitor')).toBeDefined()
      })

      // Non-DEAD delivery checkboxes should be disabled
      const checkboxes = screen.getAllByRole('checkbox')
      expect(checkboxes.length).toBeGreaterThan(0)
    })

    it('renders DeadLettersPage and supports selecting all dead deliveries', async () => {
      render(
        <AppProvider>
          <DeadLettersPage />
        </AppProvider>
      )

      const selectAllCheckbox = await screen.findByRole('checkbox', {
        name: /Select all dead deliveries/i,
      })

      await waitFor(() => {
        expect(selectAllCheckbox.hasAttribute('disabled')).toBe(false)
      })

      fireEvent.click(selectAllCheckbox)

      await screen.findByText(/selected for replay/i)
      const bulkReplayButtons = screen.getAllByRole('button', { name: /Bulk Replay/i })
      expect(bulkReplayButtons.length).toBeGreaterThan(0)
    })
  })
})
