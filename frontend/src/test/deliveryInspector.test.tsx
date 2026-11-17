// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DeliveryDetailDrawer } from '../components/DeliveryDetailDrawer'
import { DeliveriesPage } from '../pages/DeliveriesPage'
import type { Delivery } from '../types'

// Mock AppContext dependencies
const mockReplayDelivery = vi.fn()
const mockGetDeliveryById = vi.fn()
const mockGetDeliveries = vi.fn()
const mockGetEndpoints = vi.fn()
const mockAddToast = vi.fn()

const mockService = {
  getDeliveries: mockGetDeliveries,
  getDeliveryById: mockGetDeliveryById,
  replayDelivery: mockReplayDelivery,
  getEndpoints: mockGetEndpoints,
}

vi.mock('../context/AppContext', () => ({
  useApp: () => ({
    mode: 'demo',
    toggleMode: vi.fn(),
    service: mockService,
    addToast: mockAddToast,
  }),
}))

const mockDeadDelivery: Delivery = {
  id: 'del-dead-1234-5678',
  event_id: 'evt-order-9876-5432',
  endpoint_id: 'ep-orders-1111',
  endpoint_url: 'https://api.example.com/webhooks/orders',
  seq: 42,
  state: 'DEAD',
  attempt_count: 5,
  next_attempt_at: '2026-11-17T11:00:00.000Z',
  last_status_code: 500,
  last_error: 'HTTP 500 Internal Server Error: Database deadlock timeout after 3000ms',
  created_at: '2026-11-17T10:00:00.000Z',
  updated_at: '2026-11-17T10:15:00.000Z',
  event: {
    id: 'evt-order-9876-5432',
    tenant_id: 'tenant-1',
    event_type: 'order.checkout_completed',
    idempotency_key: 'idemp-order-999',
    payload: {
      orderId: 'ord-123',
      amount: 99.99,
      currency: 'USD',
      customer: { email: 'user@example.com' },
    },
    created_at: '2026-11-17T09:59:50.000Z',
  },
  endpoint: {
    id: 'ep-orders-1111',
    tenant_id: 'tenant-1',
    url: 'https://api.example.com/webhooks/orders',
    active: true,
    rate_limit_rps: 50,
    circuit_state: 'CLOSED',
    consecutive_failures: 5,
    created_at: '2026-11-01T00:00:00.000Z',
    description: 'Production Order Ingestion Service',
  },
  attempts: [
    {
      id: 1,
      delivery_id: 'del-dead-1234-5678',
      attempt_no: 1,
      started_at: '2026-11-17T10:00:05.000Z',
      status_code: 504,
      latency_ms: 5000,
      error: 'Gateway timeout after 5000ms',
    },
    {
      id: 2,
      delivery_id: 'del-dead-1234-5678',
      attempt_no: 2,
      started_at: '2026-11-17T10:05:00.000Z',
      status_code: 500,
      latency_ms: 1200,
      error: 'Database deadlock timeout after 3000ms',
    },
  ],
}

const mockSucceededDelivery: Delivery = {
  id: 'del-succ-2222-3333',
  event_id: 'evt-succ-1111',
  endpoint_id: 'ep-succ-1111',
  endpoint_url: 'https://api.example.com/webhooks/success',
  seq: 15,
  state: 'SUCCEEDED',
  attempt_count: 1,
  next_attempt_at: '2026-11-17T10:00:00.000Z',
  last_status_code: 200,
  created_at: '2026-11-17T09:00:00.000Z',
  updated_at: '2026-11-17T09:00:02.000Z',
  event: {
    id: 'evt-succ-1111',
    tenant_id: 'tenant-1',
    idempotency_key: 'idemp-succ-111',
    payload: { ping: 'pong' },
    created_at: '2026-11-17T09:00:00.000Z',
  },
  attempts: [
    {
      id: 1,
      delivery_id: 'del-succ-2222-3333',
      attempt_no: 1,
      started_at: '2026-11-17T09:00:01.000Z',
      status_code: 200,
      latency_ms: 120,
      error: null,
    },
  ],
}

const mockRetryingDelivery: Delivery = {
  id: 'del-retry-4444-5555',
  event_id: 'evt-retry-1111',
  endpoint_id: 'ep-retry-1111',
  endpoint_url: 'https://api.example.com/webhooks/retrying',
  seq: 18,
  state: 'RETRYING',
  attempt_count: 2,
  next_attempt_at: '2026-11-17T12:00:00.000Z',
  last_status_code: 503,
  last_error: 'Service temporarily overloaded',
  created_at: '2026-11-17T09:30:00.000Z',
  updated_at: '2026-11-17T09:35:00.000Z',
  attempts: [
    {
      id: 1,
      delivery_id: 'del-retry-4444-5555',
      attempt_no: 1,
      started_at: '2026-11-17T09:30:05.000Z',
      status_code: 503,
      latency_ms: 450,
      error: 'Service temporarily overloaded',
    },
  ],
}

const mockPendingDelivery: Delivery = {
  id: 'del-pend-6666-7777',
  event_id: 'evt-pend-1111',
  endpoint_id: 'ep-pend-1111',
  endpoint_url: 'https://api.example.com/webhooks/pending',
  seq: 19,
  state: 'PENDING',
  attempt_count: 0,
  next_attempt_at: '2026-11-17T10:00:00.000Z',
  created_at: '2026-11-17T10:00:00.000Z',
  updated_at: '2026-11-17T10:00:00.000Z',
  attempts: [],
}

describe('Delivery Inspector and Resend/Replay Functionality', () => {
  let clipboardWriteTextSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    clipboardWriteTextSpy = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, {
      clipboard: {
        writeText: clipboardWriteTextSpy,
      },
    })
    mockGetEndpoints.mockResolvedValue([])
    mockGetDeliveries.mockResolvedValue({
      data: [mockDeadDelivery],
      pagination: {
        page: 1,
        pageSize: 20,
        totalRecords: 1,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      },
    })
    mockGetDeliveryById.mockResolvedValue(mockDeadDelivery)
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    document.body.style.overflow = ''
  })

  describe('Delivery Inspector Rendering', () => {
    it('renders drawer title, delivery ID, and state badge', () => {
      render(
        <DeliveryDetailDrawer
          delivery={mockDeadDelivery}
          isOpen={true}
          onClose={vi.fn()}
        />
      )

      expect(screen.getByText('Delivery Inspector')).toBeDefined()
      expect(screen.getByText(/del-dead-1234-5678/)).toBeDefined()
      expect(screen.getByText('Dead Letter')).toBeDefined()
      expect(
        screen.getByText(
          'Dead Letter Queue — Retry budget exhausted. Eligible for manual replay.'
        )
      ).toBeDefined()
    })

    it('renders associated Event ID, event type, and idempotency key', () => {
      render(
        <DeliveryDetailDrawer
          delivery={mockDeadDelivery}
          isOpen={true}
          onClose={vi.fn()}
        />
      )

      expect(screen.getByText('evt-order-9876-5432')).toBeDefined()
      expect(screen.getByText('order.checkout_completed')).toBeDefined()
      expect(screen.getByText('idemp-order-999')).toBeDefined()
    })

    it('renders destination endpoint URL, POST HTTP method badge, description, and sequence number', () => {
      render(
        <DeliveryDetailDrawer
          delivery={mockDeadDelivery}
          isOpen={true}
          onClose={vi.fn()}
        />
      )

      expect(screen.getByText('https://api.example.com/webhooks/orders')).toBeDefined()
      expect(screen.getByText('POST')).toBeDefined()
      expect(screen.getByText('Production Order Ingestion Service')).toBeDefined()
      expect(screen.getByText('#42')).toBeDefined()
    })

    it('renders timestamps including Created At, Last Attempt, and Last Updated', () => {
      render(
        <DeliveryDetailDrawer
          delivery={mockDeadDelivery}
          isOpen={true}
          onClose={vi.fn()}
        />
      )

      expect(screen.getByText('Created At')).toBeDefined()
      expect(screen.getByText('Last Attempt')).toBeDefined()
      expect(screen.getByText('Last Updated')).toBeDefined()
    })

    it('renders request payload in formatted JSON viewer with syntax highlighting', () => {
      render(
        <DeliveryDetailDrawer
          delivery={mockDeadDelivery}
          isOpen={true}
          onClose={vi.fn()}
        />
      )

      expect(screen.getByText('Request Payload (HTTP POST)')).toBeDefined()
      expect(screen.getByText(/ord-123/)).toBeDefined()
      expect(screen.getByText(/user@example.com/)).toBeDefined()
    })

    it('renders HTTP response status code badge and failure diagnostic box', () => {
      render(
        <DeliveryDetailDrawer
          delivery={mockDeadDelivery}
          isOpen={true}
          onClose={vi.fn()}
        />
      )

      expect(screen.getAllByText('500 Server Error').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText('Failure Diagnostic Reason')).toBeDefined()
      expect(
        screen.getAllByText(/Database deadlock timeout after 3000ms/).length
      ).toBeGreaterThanOrEqual(1)
    })

    it('renders delivery attempt history with attempt numbers, status codes, and latency', () => {
      render(
        <DeliveryDetailDrawer
          delivery={mockDeadDelivery}
          isOpen={true}
          onClose={vi.fn()}
        />
      )

      expect(screen.getByText('Delivery Attempt History (2)')).toBeDefined()
      expect(screen.getByText('Attempt #1')).toBeDefined()
      expect(screen.getByText('Attempt #2')).toBeDefined()
      expect(screen.getByText('Initial Attempt')).toBeDefined()
      expect(screen.getByText('Automatic Retry')).toBeDefined()
      expect(screen.getByText('504 Server Error')).toBeDefined()
      expect(screen.getByText('Latency: 5.00 s')).toBeDefined()
      expect(screen.getByText('Latency: 1.20 s')).toBeDefined()
    })

    it('handles missing payload and empty attempts gracefully', () => {
      render(
        <DeliveryDetailDrawer
          delivery={mockPendingDelivery}
          isOpen={true}
          onClose={vi.fn()}
        />
      )

      expect(
        screen.getByText('No request payload recorded for this delivery event.')
      ).toBeDefined()
      expect(
        screen.getByText('No delivery attempts executed yet. Delivery is currently PENDING.')
      ).toBeDefined()
    })

    it('renders success acknowledgment banner when delivery succeeded', () => {
      render(
        <DeliveryDetailDrawer
          delivery={mockSucceededDelivery}
          isOpen={true}
          onClose={vi.fn()}
        />
      )

      expect(screen.getByText('Succeeded')).toBeDefined()
      expect(screen.getAllByText('200 OK').length).toBeGreaterThanOrEqual(1)
      expect(
        screen.getByText(
          'Endpoint returned a 2xx success response code. Delivery acknowledged and completed.'
        )
      ).toBeDefined()
    })
  })

  describe('Copy Actions', () => {
    it('copies delivery ID to clipboard when copy button is clicked', async () => {
      render(
        <DeliveryDetailDrawer
          delivery={mockDeadDelivery}
          isOpen={true}
          onClose={vi.fn()}
        />
      )

      const copyBtn = screen.getByRole('button', { name: 'Copy Delivery ID' })
      await act(async () => {
        fireEvent.click(copyBtn)
      })

      expect(clipboardWriteTextSpy).toHaveBeenCalledWith('del-dead-1234-5678')
      expect(screen.getByText('Copied ID')).toBeDefined()
    })

    it('copies event ID to clipboard when copy event button is clicked', async () => {
      render(
        <DeliveryDetailDrawer
          delivery={mockDeadDelivery}
          isOpen={true}
          onClose={vi.fn()}
        />
      )

      const copyBtn = screen.getByRole('button', { name: 'Copy Event ID' })
      await act(async () => {
        fireEvent.click(copyBtn)
      })

      expect(clipboardWriteTextSpy).toHaveBeenCalledWith('evt-order-9876-5432')
      expect(screen.getByText('Copied')).toBeDefined()
    })

    it('copies formatted JSON payload when copy payload button is clicked', async () => {
      render(
        <DeliveryDetailDrawer
          delivery={mockDeadDelivery}
          isOpen={true}
          onClose={vi.fn()}
        />
      )

      const copyBtn = screen.getByRole('button', { name: 'Copy Payload JSON' })
      await act(async () => {
        fireEvent.click(copyBtn)
      })

      expect(clipboardWriteTextSpy).toHaveBeenCalled()
      const copiedText = clipboardWriteTextSpy.mock.calls[0][0]
      expect(copiedText).toContain('ord-123')
      expect(screen.getByText('Copied Payload')).toBeDefined()
    })

    it('copies failure diagnostic error when copy diagnostic button is clicked', async () => {
      render(
        <DeliveryDetailDrawer
          delivery={mockDeadDelivery}
          isOpen={true}
          onClose={vi.fn()}
        />
      )

      const copyBtn = screen.getByRole('button', { name: 'Copy Failure Diagnostic' })
      await act(async () => {
        fireEvent.click(copyBtn)
      })

      expect(clipboardWriteTextSpy).toHaveBeenCalledWith(mockDeadDelivery.last_error)
    })
  })

  describe('Replay / Resend Eligibility and Controls', () => {
    it('disables or hides replay action for SUCCEEDED deliveries', () => {
      render(
        <DeliveryDetailDrawer
          delivery={mockSucceededDelivery}
          isOpen={true}
          onClose={vi.fn()}
        />
      )

      expect(screen.queryByRole('button', { name: 'Replay Delivery' })).toBeNull()
      expect(
        screen.getByText('Delivered successfully • Replay not required')
      ).toBeDefined()
    })

    it('disables or hides replay action for RETRYING deliveries', () => {
      render(
        <DeliveryDetailDrawer
          delivery={mockRetryingDelivery}
          isOpen={true}
          onClose={vi.fn()}
        />
      )

      expect(screen.queryByRole('button', { name: 'Replay Delivery' })).toBeNull()
      expect(
        screen.getByText('Active delivery • Managed by retry scheduler')
      ).toBeDefined()
    })

    it('disables or hides replay action for PENDING deliveries', () => {
      render(
        <DeliveryDetailDrawer
          delivery={mockPendingDelivery}
          isOpen={true}
          onClose={vi.fn()}
        />
      )

      expect(screen.queryByRole('button', { name: 'Replay Delivery' })).toBeNull()
      expect(screen.getByText('Pending dispatch in queue')).toBeDefined()
    })

    it('renders Replay Delivery button for DEAD deliveries', () => {
      render(
        <DeliveryDetailDrawer
          delivery={mockDeadDelivery}
          isOpen={true}
          onClose={vi.fn()}
        />
      )

      expect(screen.getByRole('button', { name: 'Replay Delivery' })).toBeDefined()
    })
  })

  describe('Replay Execution Flows', () => {
    it('calls onReplayRequest when parent provides callback', () => {
      const handleReplayRequest = vi.fn()
      render(
        <DeliveryDetailDrawer
          delivery={mockDeadDelivery}
          isOpen={true}
          onClose={vi.fn()}
          onReplayRequest={handleReplayRequest}
        />
      )

      const replayBtn = screen.getByRole('button', { name: 'Replay Delivery' })
      fireEvent.click(replayBtn)

      expect(handleReplayRequest).toHaveBeenCalledWith(mockDeadDelivery)
    })

    it('opens inline ConfirmationDialog and allows cancellation when onReplayRequest is omitted', () => {
      render(
        <DeliveryDetailDrawer
          delivery={mockDeadDelivery}
          isOpen={true}
          onClose={vi.fn()}
        />
      )

      const replayBtn = screen.getByRole('button', { name: 'Replay Delivery' })
      fireEvent.click(replayBtn)

      // Dialog opens
      expect(screen.getByRole('alertdialog')).toBeDefined()
      expect(screen.getByText('Confirm Delivery Replay')).toBeDefined()
      expect(screen.getByText('Ordering Guarantee Notice')).toBeDefined()

      // Cancel button closes dialog
      const cancelBtn = screen.getByRole('button', { name: 'Cancel' })
      fireEvent.click(cancelBtn)

      expect(screen.queryByRole('alertdialog')).toBeNull()
      expect(mockReplayDelivery).not.toHaveBeenCalled()
    })

    it('executes replay via inline ConfirmationDialog, handles loading state, toasts, and updates status', async () => {
      const replayedDelivery: Delivery = {
        ...mockDeadDelivery,
        state: 'PENDING',
        last_error: null,
      }
      mockReplayDelivery.mockResolvedValueOnce({
        success: true,
        message: 'Delivery replayed successfully',
        delivery: replayedDelivery,
      })
      mockGetDeliveryById.mockResolvedValueOnce(replayedDelivery)

      const onReplaySuccess = vi.fn()

      render(
        <DeliveryDetailDrawer
          delivery={mockDeadDelivery}
          isOpen={true}
          onClose={vi.fn()}
          onReplaySuccess={onReplaySuccess}
        />
      )

      // Open confirmation dialog
      fireEvent.click(screen.getByRole('button', { name: 'Replay Delivery' }))

      const confirmBtn = screen.getByRole('button', { name: 'Confirm & Replay' })
      await act(async () => {
        fireEvent.click(confirmBtn)
      })

      expect(mockReplayDelivery).toHaveBeenCalledWith(mockDeadDelivery.id)
      expect(mockAddToast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'success',
          title: 'Replay Queued',
        })
      )
      expect(onReplaySuccess).toHaveBeenCalled()

      // Dialog closes and drawer shows updated Pending status badge
      await waitFor(() => {
        expect(screen.queryByRole('alertdialog')).toBeNull()
        expect(screen.getByText('Pending')).toBeDefined()
      })
    })

    it('prevents duplicate replay clicks during execution', async () => {
      let resolvePromise: (value: any) => void
      const deferred = new Promise((resolve) => {
        resolvePromise = resolve
      })
      mockReplayDelivery.mockReturnValueOnce(deferred)

      render(
        <DeliveryDetailDrawer
          delivery={mockDeadDelivery}
          isOpen={true}
          onClose={vi.fn()}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: 'Replay Delivery' }))
      const confirmBtn = screen.getByRole('button', { name: 'Confirm & Replay' })

      act(() => {
        fireEvent.click(confirmBtn)
      })

      // Button is now disabled and loading
      expect(confirmBtn.getAttribute('disabled')).not.toBeNull()

      // Second click does nothing
      act(() => {
        fireEvent.click(confirmBtn)
      })
      expect(mockReplayDelivery).toHaveBeenCalledTimes(1)

      // Resolve the request
      await act(async () => {
        resolvePromise!({ success: true, message: 'Replayed' })
      })
    })
  })

  describe('Integration with DeliveriesPage', () => {
    it('opens DeliveryDetailDrawer when inspecting a row in DeliveriesPage', async () => {
      render(
        <MemoryRouter>
          <DeliveriesPage />
        </MemoryRouter>
      )

      await waitFor(() => {
        expect(screen.getByText(/del-dead/)).toBeDefined()
      })

      // Click row to inspect
      const row = screen.getByText(/del-dead/).closest('tr')!
      await act(async () => {
        fireEvent.click(row)
      })

      // DeliveryDetailDrawer is open
      await waitFor(() => {
        expect(screen.getByText('Delivery Inspector')).toBeDefined()
        expect(
          screen.getAllByText('https://api.example.com/webhooks/orders').length
        ).toBe(2)
      })
    })
  })
})
