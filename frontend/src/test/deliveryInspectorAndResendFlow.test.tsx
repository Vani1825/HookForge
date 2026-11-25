// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DeliveryDetailDrawer } from '../components/DeliveryDetailDrawer'
import { ResendModal } from '../components/ResendModal'
import { AppProvider } from '../context/AppContext'
import { mockStore } from '../mocks/mockStore'
import type { Delivery } from '../types'

vi.mock('../api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
  formatErrorMessage: (err: any) =>
    err?.response?.data?.message || err?.message || 'Network Error',
}))

describe("Tanvi's Phase 2 Task: Delivery Inspector & Resend Flow (Frontend)", () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    localStorage.setItem('hookforge_app_mode', 'demo')
    const existing = (mockStore as any).deliveries.find((d: Delivery) => d.id === baseDelivery.id)
    if (existing) {
      Object.assign(existing, { ...baseDelivery })
    } else {
      (mockStore as any).deliveries.push({ ...baseDelivery })
    }
    (mockStore as any).attempts[baseDelivery.id] = [...(baseDelivery.attempts || [])]
  })

  const baseDelivery: Delivery = {
    id: 'del-inspect-100',
    event_id: 'ev-100',
    endpoint_id: 'ep-100',
    endpoint_url: 'https://webhook.receiver.example/events',
    seq: 12,
    state: 'DEAD',
    attempt_count: 3,
    last_status_code: 504,
    last_error: 'Socket timeout 504',
    created_at: '2026-11-20T10:00:00.000Z',
    updated_at: '2026-11-20T10:10:00.000Z',
    next_attempt_at: '2026-11-20T10:15:00.000Z',
    attempts: [
      {
        id: 'att-inspect-1',
        delivery_id: 'del-inspect-100',
        attempt_no: 1,
        started_at: '2026-11-20T10:00:00.000Z',
        status_code: 504,
        latency_ms: 3000,
        error: 'Socket timeout',
        request_headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': '[REDACTED]',
        },
        response_headers: {
          'Server': 'cloudflare',
          'Content-Type': 'text/html',
        },
        response_body: '<html>Gateway Timeout 504 ... [TRUNCATED - EXCEEDED 64KB LIMIT]</html>',
      },
    ],
  }

  // =========================================================================
  // 1. Delivery Inspector UI: Request Headers, Response Headers, Response Body
  // =========================================================================
  describe('1. DeliveryDetailDrawer: Metadata Inspection', () => {
    it('renders Request Headers, Response Headers, and Response Body in expanded attempt view', async () => {
      render(
        <MemoryRouter>
          <AppProvider>
            <DeliveryDetailDrawer
              delivery={baseDelivery}
              isOpen={true}
              onClose={vi.fn()}
            />
          </AppProvider>
        </MemoryRouter>
      )

      // Switch to Attempt History tab
      const attemptsTab = screen.getByRole('button', { name: /Attempt History/i })
      fireEvent.click(attemptsTab)

      await waitFor(() => {
        expect(screen.getByText(/Attempt #1/i)).toBeDefined()
      })

      // Click to expand details
      const viewDetailsBtn = screen.getByText(/View Response Details/i)
      fireEvent.click(viewDetailsBtn)

      // Verify Request Headers section
      await waitFor(() => {
        expect(screen.getByText(/Request Headers/i)).toBeDefined()
      })
      expect(screen.getAllByText('Content-Type:').length).toBe(2)
      expect(screen.getByText('[REDACTED]')).toBeDefined()

      // Verify Response Headers section
      expect(screen.getByText(/Response Headers/i)).toBeDefined()
      expect(screen.getByText('Server:')).toBeDefined()
      expect(screen.getByText('cloudflare')).toBeDefined()

      // Verify Response Body section
      expect(screen.getByText(/Response Body/i)).toBeDefined()
      expect(screen.getByText(/Gateway Timeout 504/i)).toBeDefined()

      // Verify Truncation notice
      expect(screen.getByText(/Truncated \(64KB capture limit\)/i)).toBeDefined()
    })

    it('handles attempts with missing request headers, response headers, or body gracefully', async () => {
      const minimalDelivery: Delivery = {
        ...baseDelivery,
        id: 'del-inspect-minimal',
        attempts: [
          {
            id: 'att-minimal',
            delivery_id: 'del-inspect-minimal',
            attempt_no: 1,
            started_at: '2026-11-20T10:00:00.000Z',
            status_code: null,
            latency_ms: 120,
            error: 'DNS lookup failed',
            request_headers: null,
            response_headers: null,
            response_body: null,
          },
        ],
      }

      render(
        <MemoryRouter>
          <AppProvider>
            <DeliveryDetailDrawer
              delivery={minimalDelivery}
              isOpen={true}
              onClose={vi.fn()}
            />
          </AppProvider>
        </MemoryRouter>
      )

      const attemptsTab = screen.getByRole('button', { name: /Attempt History/i })
      fireEvent.click(attemptsTab)

      await waitFor(() => {
        expect(screen.getByText(/Attempt #1/i)).toBeDefined()
        expect(screen.getByText(/DNS lookup failed/i)).toBeDefined()
      })

      // Expand button should not render when there are no headers or body
      expect(screen.queryByText(/View Response Details/i)).toBeNull()
    })
  })

  // =========================================================================
  // 2. Resend Webhook Action Eligibility
  // =========================================================================
  describe('2. Resend Webhook Action Eligibility in DeliveryDetailDrawer', () => {
    it('shows Resend Webhook button for DEAD delivery', () => {
      render(
        <MemoryRouter>
          <AppProvider>
            <DeliveryDetailDrawer
              delivery={{ ...baseDelivery, state: 'DEAD' }}
              isOpen={true}
              onClose={vi.fn()}
            />
          </AppProvider>
        </MemoryRouter>
      )

      expect(screen.getByTestId('resend-webhook-button')).toBeDefined()
      expect(screen.getByRole('button', { name: /Resend Webhook/i })).toBeDefined()
    })

    it('shows Resend Webhook button for SUCCEEDED delivery', () => {
      render(
        <MemoryRouter>
          <AppProvider>
            <DeliveryDetailDrawer
              delivery={{ ...baseDelivery, state: 'SUCCEEDED', last_status_code: 200 }}
              isOpen={true}
              onClose={vi.fn()}
            />
          </AppProvider>
        </MemoryRouter>
      )

      expect(screen.getByTestId('resend-webhook-button')).toBeDefined()
    })

    it('shows Resend Webhook button for CANCELLED delivery', () => {
      render(
        <MemoryRouter>
          <AppProvider>
            <DeliveryDetailDrawer
              delivery={{ ...baseDelivery, state: 'CANCELLED' }}
              isOpen={true}
              onClose={vi.fn()}
            />
          </AppProvider>
        </MemoryRouter>
      )

      expect(screen.getByTestId('resend-webhook-button')).toBeDefined()
    })

    it('does NOT show Resend Webhook button for IN_FLIGHT delivery and renders active dispatch badge', () => {
      render(
        <MemoryRouter>
          <AppProvider>
            <DeliveryDetailDrawer
              delivery={{ ...baseDelivery, state: 'IN_FLIGHT' }}
              isOpen={true}
              onClose={vi.fn()}
            />
          </AppProvider>
        </MemoryRouter>
      )

      expect(screen.queryByTestId('resend-webhook-button')).toBeNull()
      expect(screen.getByTestId('dispatch-in-flight-badge')).toBeDefined()
      expect(screen.getByText(/Dispatch In Flight/i)).toBeDefined()
    })
  })

  // =========================================================================
  // 3. ResendModal: State Notices & Execution Mode Selection
  // =========================================================================
  describe('3. ResendModal: State Notices & Execution Modes', () => {
    it('renders duplicate delivery warning when resending a SUCCEEDED delivery', () => {
      render(
        <MemoryRouter>
          <AppProvider>
            <ResendModal
              delivery={{ ...baseDelivery, state: 'SUCCEEDED' }}
              isOpen={true}
              onClose={vi.fn()}
              onSuccess={vi.fn()}
            />
          </AppProvider>
        </MemoryRouter>
      )

      expect(screen.getByText(/Duplicate Delivery Warning/i)).toBeDefined()
      expect(screen.getByText(/previously/i)).toBeDefined()
    })

    it('renders ordering guarantee notice when resending a DEAD delivery', () => {
      render(
        <MemoryRouter>
          <AppProvider>
            <ResendModal
              delivery={{ ...baseDelivery, state: 'DEAD' }}
              isOpen={true}
              onClose={vi.fn()}
              onSuccess={vi.fn()}
            />
          </AppProvider>
        </MemoryRouter>
      )

      expect(screen.getByText(/Ordering Guarantee Notice/i)).toBeDefined()
      expect(screen.getByText(/released/i)).toBeDefined()
    })

    it('renders reactivation notice when resending a CANCELLED delivery', () => {
      render(
        <MemoryRouter>
          <AppProvider>
            <ResendModal
              delivery={{ ...baseDelivery, state: 'CANCELLED' }}
              isOpen={true}
              onClose={vi.fn()}
              onSuccess={vi.fn()}
            />
          </AppProvider>
        </MemoryRouter>
      )

      expect(screen.getByText(/Reactivating Cancelled Delivery/i)).toBeDefined()
    })

    it('allows toggling between Queued Resend and Immediate Execution', () => {
      render(
        <MemoryRouter>
          <AppProvider>
            <ResendModal
              delivery={baseDelivery}
              isOpen={true}
              onClose={vi.fn()}
              onSuccess={vi.fn()}
            />
          </AppProvider>
        </MemoryRouter>
      )

      // Default should be Queued Resend
      expect(screen.getByRole('button', { name: /Queue Resend/i })).toBeDefined()

      // Switch to Immediate Execution
      const immediateOption = screen.getByTestId('resend-mode-immediate')
      fireEvent.click(immediateOption)

      expect(screen.getByRole('button', { name: /Execute Immediately/i })).toBeDefined()

      // Switch back to Queued
      const queuedOption = screen.getByTestId('resend-mode-queued')
      fireEvent.click(queuedOption)

      expect(screen.getByRole('button', { name: /Queue Resend/i })).toBeDefined()
    })

    it('submits queued resend with immediate: false', async () => {
      const onSuccessMock = vi.fn()
      const onCloseMock = vi.fn()
      const targetDelivery = { ...baseDelivery, id: 'del-resend-test-1', state: 'DEAD' as const }
      ;(mockStore as any).deliveries.push(targetDelivery)

      render(
        <MemoryRouter>
          <AppProvider>
            <ResendModal
              delivery={targetDelivery}
              isOpen={true}
              onClose={onCloseMock}
              onSuccess={onSuccessMock}
            />
          </AppProvider>
        </MemoryRouter>
      )

      const submitBtn = screen.getByRole('button', { name: /Queue Resend/i })
      fireEvent.click(submitBtn)

      await waitFor(() => {
        expect(onSuccessMock).toHaveBeenCalled()
        expect(onCloseMock).toHaveBeenCalled()
      })

      const result = onSuccessMock.mock.calls[0][0]
      expect(result.success).toBe(true)
      expect(result.delivery?.state).toBe('PENDING')
    })

    it('submits immediate resend with immediate: true', async () => {
      const onSuccessMock = vi.fn()
      const onCloseMock = vi.fn()
      const targetDelivery = { ...baseDelivery, id: 'del-resend-test-2', state: 'DEAD' as const }
      ;(mockStore as any).deliveries.push(targetDelivery)

      render(
        <MemoryRouter>
          <AppProvider>
            <ResendModal
              delivery={targetDelivery}
              isOpen={true}
              onClose={onCloseMock}
              onSuccess={onSuccessMock}
            />
          </AppProvider>
        </MemoryRouter>
      )

      fireEvent.click(screen.getByTestId('resend-mode-immediate'))
      const submitBtn = screen.getByRole('button', { name: /Execute Immediately/i })
      fireEvent.click(submitBtn)

      await waitFor(() => {
        expect(onSuccessMock).toHaveBeenCalled()
        expect(onCloseMock).toHaveBeenCalled()
      })

      const result = onSuccessMock.mock.calls[0][0]
      expect(result.success).toBe(true)
      expect(result.delivery?.state).toBe('SUCCEEDED')
      expect(result.attempt).toBeDefined()
    })
  })

  // =========================================================================
  // 4. Backward Compatibility
  // =========================================================================
  describe('4. Backward Compatibility', () => {
    it('preserves Replay Dead Delivery button and calls onReplayRequest for DEAD deliveries', () => {
      const onReplayMock = vi.fn()

      render(
        <MemoryRouter>
          <AppProvider>
            <DeliveryDetailDrawer
              delivery={{ ...baseDelivery, state: 'DEAD' }}
              isOpen={true}
              onClose={vi.fn()}
              onReplayRequest={onReplayMock}
            />
          </AppProvider>
        </MemoryRouter>
      )

      const replayBtn = screen.getByRole('button', { name: /Replay.*Delivery/i })
      expect(replayBtn).toBeDefined()
      fireEvent.click(replayBtn)
      expect(onReplayMock).toHaveBeenCalled()
    })
  })
})
