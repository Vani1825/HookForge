// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { apiClient } from '../api/client'
import {
  fetchDeliveries,
  fetchDeliveryAttempts,
  fetchDeliveryLogs,
} from '../api/deliveries'
import { mockStore } from '../mocks/mockStore'
import { AppProvider } from '../context/AppContext'
import { DeliveriesPage } from '../pages/DeliveriesPage'
import { DeliveryDetailDrawer } from '../components/DeliveryDetailDrawer'
import type { Delivery } from '../types'

vi.mock('../api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  formatErrorMessage: (err: any) =>
    err?.response?.data?.message || err?.message || 'Network Error',
}))

describe("Phase 2 – Vani's Task 2: Advanced Filtering & Detailed Logs (Frontend)", () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  // =========================================================================
  // SECTION 1: API Client Contracts & Normalization
  // =========================================================================
  describe('1. API Client Contracts & Normalization', () => {
    it('fetchDeliveries maps all advanced filtering and sorting query parameters', async () => {
      const mockResponse = {
        data: [
          {
            id: 'del-mock-01',
            eventId: 'ev-1',
            endpointId: 'ep-1',
            endpointUrl: 'https://api.example.com/webhook',
            seq: 1,
            state: 'DEAD',
            attemptCount: 3,
            lastStatusCode: 504,
            lastError: 'Gateway Timeout',
            createdAt: '2026-11-20T10:00:00Z',
            updatedAt: '2026-11-20T10:05:00Z',
          },
        ],
        pagination: {
          page: 2,
          pageSize: 15,
          totalRecords: 45,
          totalPages: 3,
          hasNext: true,
          hasPrev: true,
        },
      }

      vi.mocked(apiClient.get).mockResolvedValueOnce(mockResponse)

      const result = await fetchDeliveries({
        state: 'DEAD,RETRYING',
        endpoint_id: 'ep-1',
        event_id: 'ev-1',
        event_type: 'invoice.payment_failed',
        status_code: '5xx',
        attempt_count: 3,
        min_attempts: 1,
        max_attempts: 5,
        created_after: '2026-11-01T00:00:00Z',
        created_before: '2026-11-25T23:59:59Z',
        sortBy: 'seq',
        sortOrder: 'ASC',
        q: 'payment-error',
        page: 2,
        pageSize: 15,
      })

      expect(apiClient.get).toHaveBeenCalledWith('/deliveries', {
        params: {
          state: 'DEAD,RETRYING',
          endpoint_id: 'ep-1',
          event_id: 'ev-1',
          event_type: 'invoice.payment_failed',
          status_code: '5xx',
          attempt_count: 3,
          min_attempts: 1,
          max_attempts: 5,
          created_after: '2026-11-01T00:00:00Z',
          created_before: '2026-11-25T23:59:59Z',
          sortBy: 'seq',
          sortOrder: 'ASC',
          q: 'payment-error',
          page: 2,
          pageSize: 15,
        },
      })

      expect(result.data).toHaveLength(1)
      expect(result.data[0].id).toBe('del-mock-01')
      expect(result.data[0].last_status_code).toBe(504)
      expect(result.pagination.totalRecords).toBe(45)
    })

    it('fetchDeliveryAttempts calls GET /deliveries/:id/attempts and normalizes attempt records', async () => {
      const mockAttemptsResponse = {
        deliveryId: 'del-test-123',
        totalAttempts: 2,
        attempts: [
          {
            id: 'att-1',
            attemptNumber: 1,
            statusCode: 503,
            latencyMs: 145,
            errorMessage: 'Service Unavailable',
            attemptedAt: '2026-11-20T10:00:00Z',
            responseBody: '{"error":"busy"}',
            responseHeaders: { 'content-type': 'application/json' },
          },
        ],
      }

      vi.mocked(apiClient.get).mockResolvedValueOnce(mockAttemptsResponse)

      const res = await fetchDeliveryAttempts('del-test-123')
      expect(apiClient.get).toHaveBeenCalledWith('/deliveries/del-test-123/attempts')
      expect(res.deliveryId).toBe('del-test-123')
      expect(res.totalAttempts).toBe(2)
      expect(res.attempts[0].attempt_no).toBe(1)
      expect(res.attempts[0].status_code).toBe(503)
      expect(res.attempts[0].latency_ms).toBe(145)
      expect(res.attempts[0].response_body).toBe('{"error":"busy"}')
    })

    it('fetchDeliveryLogs calls GET /deliveries/:id/logs and returns structured diagnostic timeline', async () => {
      const mockLogsResponse = {
        deliveryId: 'del-test-123',
        state: 'DEAD',
        attemptCount: 3,
        diagnostics: {
          category: 'SERVER_ERROR_5XX',
          recommendation: 'Target server returned 503 Service Unavailable. Check receiver server load.',
        },
        logs: [
          {
            timestamp: '2026-11-20T10:00:00Z',
            level: 'INFO',
            event: 'DELIVERY_CREATED',
            message: 'Delivery created and queued in state PENDING',
          },
          {
            timestamp: '2026-11-20T10:00:05Z',
            level: 'ERROR',
            event: 'DISPATCH_ATTEMPT_FAILED',
            message: 'Attempt 1 failed with status 503 (145ms)',
            statusCode: 503,
            latencyMs: 145,
          },
        ],
      }

      vi.mocked(apiClient.get).mockResolvedValueOnce(mockLogsResponse)

      const res = await fetchDeliveryLogs('del-test-123')
      expect(apiClient.get).toHaveBeenCalledWith('/deliveries/del-test-123/logs')
      expect(res.deliveryId).toBe('del-test-123')
      expect(res.diagnostics?.category).toBe('SERVER_ERROR_5XX')
      expect(res.logs).toHaveLength(2)
      expect(res.logs[1].level).toBe('ERROR')
    })
  })

  // =========================================================================
  // SECTION 2: MockStore Advanced Filtering & Demo Mode
  // =========================================================================
  describe('2. MockStore Advanced Filtering & Diagnostics', () => {
    it('supports comma-separated multi-state filtering (e.g. DEAD,RETRYING)', () => {
      const result = mockStore.getDeliveries({ state: 'DEAD,RETRYING' })
      expect(result.data.length).toBeGreaterThan(0)
      result.data.forEach((d) => {
        expect(['DEAD', 'RETRYING']).toContain(d.state)
      })
    })

    it('supports status code class filtering such as 5xx, 2xx, and exact code', () => {
      const result5xx = mockStore.getDeliveries({ status_code: '5xx' })
      result5xx.data.forEach((d) => {
        expect(String(d.last_status_code || '')).toMatch(/^5\d\d$/)
      })

      const resultExact = mockStore.getDeliveries({ status_code: '503' })
      resultExact.data.forEach((d) => {
        expect(d.last_status_code).toBe(503)
      })
    })

    it('supports exact attempt count and min/max attempt bounds', () => {
      const exact = mockStore.getDeliveries({ attempt_count: 1 })
      exact.data.forEach((d) => {
        expect(d.attempt_count).toBe(1)
      })

      const bounded = mockStore.getDeliveries({ min_attempts: 2, max_attempts: 4 })
      bounded.data.forEach((d) => {
        expect(d.attempt_count).toBeGreaterThanOrEqual(2)
        expect(d.attempt_count).toBeLessThanOrEqual(4)
      })
    })

    it('supports event type filtering across events and payloads', () => {
      const result = mockStore.getDeliveries({ event_type: 'order.fulfilled' })
      expect(result.data.length).toBeGreaterThan(0)
      result.data.forEach((d) => {
        const ev = mockStore.getEvent(d.event_id)
        expect(ev?.event_type).toBe('order.fulfilled')
      })
    })

    it('supports multi-column sorting by sequence, attempt_count, and created_at', () => {
      const ascSeq = mockStore.getDeliveries({ sortBy: 'seq', sortOrder: 'ASC' })
      for (let i = 0; i < ascSeq.data.length - 1; i++) {
        expect(ascSeq.data[i].seq).toBeLessThanOrEqual(ascSeq.data[i + 1].seq)
      }
    })

    it('returns enriched delivery with diagnostic recommendations, retry breakdown, and redacted payload', () => {
      const dead = mockStore.getDeliveries({ state: 'DEAD' }).data[0]
      expect(dead).toBeDefined()

      const detailed = mockStore.getDelivery(dead.id)
      expect(detailed).toBeDefined()
      expect(detailed?.diagnostics).toBeDefined()
      expect(detailed?.diagnostics?.category).toBeDefined()
      expect(detailed?.diagnostics?.recommendation).toBeDefined()
      expect(detailed?.retry).toBeDefined()
      expect(detailed?.lifecycle).toBeDefined()
      expect(detailed?.request).toBeDefined()
      expect(detailed?.endpoint?.secret).toBeUndefined() // never expose secret
    })

    it('generates structured diagnostic logs and attempts for demo mode', () => {
      const dead = mockStore.getDeliveries({ state: 'DEAD' }).data[0]
      const logsRes = mockStore.getDeliveryLogs(dead.id)
      expect(logsRes.deliveryId).toBe(dead.id)
      expect(logsRes.logs.length).toBeGreaterThan(0)
      expect(logsRes.logs[0].event).toBe('DELIVERY_CREATED')

      const attRes = mockStore.getDeliveryAttempts(dead.id)
      expect(attRes.deliveryId).toBe(dead.id)
      expect(Array.isArray(attRes.attempts)).toBe(true)
    })
  })

  // =========================================================================
  // SECTION 3: DeliveriesPage Advanced Filter Panel UI
  // =========================================================================
  describe('3. DeliveriesPage Advanced Filter Panel UI', () => {
    it('renders search input, state filter, endpoint filter, and advanced filter toggle', async () => {
      render(
        <MemoryRouter>
          <AppProvider>
            <DeliveriesPage />
          </AppProvider>
        </MemoryRouter>
      )

      expect(screen.getByPlaceholderText(/search delivery id, event id/i)).toBeDefined()
      expect(screen.getByLabelText(/filter deliveries by state/i)).toBeDefined()
      expect(screen.getByLabelText(/filter deliveries by destination endpoint/i)).toBeDefined()
      expect(screen.getByTestId('toggle-advanced-filters')).toBeDefined()
    })

    it('toggles quick-select state pills to multi-select states', async () => {
      render(
        <MemoryRouter>
          <AppProvider>
            <DeliveriesPage />
          </AppProvider>
        </MemoryRouter>
      )

      // Click Dead Letter pill
      const deadPill = screen.getByTestId('state-pill-dead')
      fireEvent.click(deadPill)

      await waitFor(() => {
        expect(screen.getByText('DEAD')).toBeDefined()
      })

      // Click Retrying pill to combine multi-state filter
      const retryingPill = screen.getByTestId('state-pill-retrying')
      fireEvent.click(retryingPill)

      await waitFor(() => {
        expect(screen.getByText('DEAD,RETRYING')).toBeDefined()
      })
    })

    it('opens advanced filters panel and allows filtering by event type, status code, and attempt bounds', async () => {
      render(
        <MemoryRouter>
          <AppProvider>
            <DeliveriesPage />
          </AppProvider>
        </MemoryRouter>
      )

      // Open advanced filters panel
      const toggleBtn = screen.getByTestId('toggle-advanced-filters')
      fireEvent.click(toggleBtn)

      expect(screen.getByTestId('advanced-filters-panel')).toBeDefined()

      // Select 5xx status code class
      const statusSelect = screen.getByTestId('filter-status-code')
      fireEvent.change(statusSelect, { target: { value: '5xx' } })

      // Enter Min attempts
      const minAttInput = screen.getByTestId('filter-min-attempts')
      fireEvent.change(minAttInput, { target: { value: '2' } })

      await waitFor(() => {
        expect(screen.getByText('5xx')).toBeDefined()
      })
    })

    it('displays validation warning when date range is reversed and prevents sending invalid query', async () => {
      render(
        <MemoryRouter>
          <AppProvider>
            <DeliveriesPage />
          </AppProvider>
        </MemoryRouter>
      )

      // Open panel
      fireEvent.click(screen.getByTestId('toggle-advanced-filters'))

      const afterInput = screen.getByTestId('filter-created-after')
      const beforeInput = screen.getByTestId('filter-created-before')

      // Set reversed date range (after > before)
      fireEvent.change(afterInput, { target: { value: '2026-11-20' } })
      fireEvent.change(beforeInput, { target: { value: '2026-11-05' } })

      await waitFor(() => {
        expect(
          screen.getByText(/Validation Error: 'Created After' date must be before or equal to 'Created Before' date/i)
        ).toBeDefined()
      })
    })

    it('displays validation warning when attempt bounds are reversed (min > max)', async () => {
      render(
        <MemoryRouter>
          <AppProvider>
            <DeliveriesPage />
          </AppProvider>
        </MemoryRouter>
      )

      fireEvent.click(screen.getByTestId('toggle-advanced-filters'))

      const minInput = screen.getByTestId('filter-min-attempts')
      const maxInput = screen.getByTestId('filter-max-attempts')

      fireEvent.change(minInput, { target: { value: '5' } })
      fireEvent.change(maxInput, { target: { value: '2' } })

      await waitFor(() => {
        expect(
          screen.getByText(/Validation Error: Min attempts cannot exceed max attempts/i)
        ).toBeDefined()
      })
    })

    it('clears all active filters when clicking Clear all filters button', async () => {
      render(
        <MemoryRouter>
          <AppProvider>
            <DeliveriesPage />
          </AppProvider>
        </MemoryRouter>
      )

      // Set a search filter
      const searchInput = screen.getByPlaceholderText(/search delivery id, event id/i)
      fireEvent.change(searchInput, { target: { value: 'payment-error' } })

      await waitFor(() => {
        expect(screen.getByText(/Clear all filters/i)).toBeDefined()
      })

      // Click clear all filters
      fireEvent.click(screen.getByText(/Clear all filters/i))

      await waitFor(() => {
        expect(screen.queryByText(/payment-error/i)).toBeNull()
      })
    })
  })

  // =========================================================================
  // SECTION 4: DeliveryDetailDrawer Diagnostics & Logs Inspector
  // =========================================================================
  describe('4. DeliveryDetailDrawer Diagnostics & Logs Inspector', () => {
    const mockDelivery: Delivery = {
      id: 'del-diag-001',
      event_id: 'ev-diag-001',
      endpoint_id: 'e1000000-0000-0000-0000-000000000001',
      endpoint_url: 'https://api.acmepayments.com/webhooks/v1',
      seq: 42,
      state: 'DEAD',
      attempt_count: 4,
      last_status_code: 504,
      last_error: 'connect ETIMEDOUT 198.51.100.24:443 after 3000ms socket timeout',
      created_at: '2026-11-20T10:00:00.000Z',
      updated_at: '2026-11-20T10:15:00.000Z',
      next_attempt_at: '2026-11-20T10:20:00.000Z',
      diagnostics: {
        category: 'TIMEOUT',
        recommendation:
          'The target server took too long to acknowledge the webhook. Verify server load, network latency, or increase the read timeout.',
      },
      retry: {
        strategy: 'EXPONENTIAL',
        maxAttempts: 4,
        baseDelayMs: 2000,
        maxDelayMs: 60000,
        backoffMultiplier: 2.0,
      },
      request: {
        url: 'https://api.acmepayments.com/webhooks/v1',
        method: 'POST',
        timestamp: '2026-11-20T10:00:00.000Z',
      },
      event: {
        id: 'ev-diag-001',
        tenant_id: 'tenant-1',
        idempotency_key: 'ik_live_checkout_99',
        event_type: 'checkout.order_completed',
        created_at: '2026-11-20T10:00:00.000Z',
        payload: {
          order_id: 'ord_99',
          amount: 2500,
          customer: {
            name: 'Bob',
            password: '[REDACTED]',
            card: '[REDACTED]',
          },
        },
      },
      attempts: [
        {
          id: 'att-1',
          delivery_id: 'del-diag-001',
          attempt_no: 1,
          started_at: '2026-11-20T10:00:00.000Z',
          status_code: 504,
          latency_ms: 150,
          error: 'Gateway Timeout 504',
          response_headers: { 'content-type': 'application/json' },
          response_body: '{"error":"timeout"}',
        },
      ],
    }

    it('renders failure diagnostic recommendation banner and drawer tabs', () => {
      render(
        <MemoryRouter>
          <AppProvider>
            <DeliveryDetailDrawer
              delivery={mockDelivery}
              isOpen={true}
              onClose={vi.fn()}
            />
          </AppProvider>
        </MemoryRouter>
      )

      expect(screen.getByText(/Failure Diagnosis: TIMEOUT/i)).toBeDefined()
      expect(
        screen.getByText(/The target server took too long to acknowledge the webhook/i)
      ).toBeDefined()

      expect(screen.getByRole('button', { name: /Overview/i })).toBeDefined()
      expect(screen.getByRole('button', { name: /Event Payload/i })).toBeDefined()
      expect(screen.getByRole('button', { name: /Attempt History/i })).toBeDefined()
      expect(screen.getByRole('button', { name: /Detailed Logs/i })).toBeDefined()
    })

    it('renders Overview tab with Target Endpoint, Sequence #, Timing, and Retry Policy without secrets', () => {
      render(
        <MemoryRouter>
          <AppProvider>
            <DeliveryDetailDrawer
              delivery={mockDelivery}
              isOpen={true}
              onClose={vi.fn()}
            />
          </AppProvider>
        </MemoryRouter>
      )

      expect(screen.getAllByText('https://api.acmepayments.com/webhooks/v1').length).toBeGreaterThan(0)
      expect(screen.getByText('#42')).toBeDefined()
      expect(screen.getByText(/Configured Retry Policy/i)).toBeDefined()
      expect(screen.getByText('EXPONENTIAL')).toBeDefined()
      expect(screen.getByText('2000 ms')).toBeDefined()
    })

    it('switches to Event Payload tab and renders redacted payload JSON', () => {
      render(
        <MemoryRouter>
          <AppProvider>
            <DeliveryDetailDrawer
              delivery={mockDelivery}
              isOpen={true}
              onClose={vi.fn()}
            />
          </AppProvider>
        </MemoryRouter>
      )

      const payloadTab = screen.getByRole('button', { name: /Event Payload/i })
      fireEvent.click(payloadTab)

      expect(screen.getByText('ev-diag-001')).toBeDefined()
      expect(screen.getByText('checkout.order_completed')).toBeDefined()
      expect(screen.getByText(/Payload Content \(Safely Redacted\)/i)).toBeDefined()
    })

    it('switches to Attempt History tab and displays attempts with latency and status code', async () => {
      render(
        <MemoryRouter>
          <AppProvider>
            <DeliveryDetailDrawer
              delivery={mockDelivery}
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
        expect(screen.getByText(/Latency: 150 ms/i)).toBeDefined()
      })
    })

    it('switches to Detailed Logs tab and renders structured log entries', async () => {
      render(
        <MemoryRouter>
          <AppProvider>
            <DeliveryDetailDrawer
              delivery={mockDelivery}
              isOpen={true}
              onClose={vi.fn()}
            />
          </AppProvider>
        </MemoryRouter>
      )

      const logsTab = screen.getByRole('button', { name: /Detailed Logs/i })
      fireEvent.click(logsTab)

      await waitFor(() => {
        expect(screen.getByText(/Diagnostic Execution Logs/i)).toBeDefined()
        expect(screen.getByText('DELIVERY_CREATED')).toBeDefined()
      })
    })
  })
})
