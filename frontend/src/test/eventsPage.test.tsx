// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { EventsPage } from '../pages/EventsPage'
import type { WebhookEvent, Delivery } from '../types'
import * as formatters from '../utils/formatters'

const mockGetEvents = vi.fn()
const mockGetDeliveries = vi.fn()
const mockGetEventById = vi.fn()
const mockIngestEvent = vi.fn()
const mockAddToast = vi.fn()

const mockService = {
  getEvents: mockGetEvents,
  getDeliveries: mockGetDeliveries,
  getEventById: mockGetEventById,
  ingestEvent: mockIngestEvent,
}

let mockAppMode = 'live'

vi.mock('../context/AppContext', () => ({
  useApp: () => ({
    mode: mockAppMode,
    toggleMode: vi.fn(),
    service: mockService,
    addToast: mockAddToast,
  }),
}))

const sampleEvents: WebhookEvent[] = [
  {
    id: 'evt-101-uuid',
    tenant_id: 'tenant-1',
    event_type: 'order.created',
    idempotency_key: 'ik-order-101',
    payload: { orderId: 101, amount: 99.5 },
    created_at: '2026-11-17T10:00:00.000Z',
  },
  {
    id: 'evt-102-uuid',
    tenant_id: 'tenant-1',
    event_type: 'user.signup',
    idempotency_key: 'ik-user-102',
    payload: { userId: 'u-102', email: 'test@example.com' },
    created_at: '2026-11-17T10:05:00.000Z',
  },
]

const sampleDeliveries: Delivery[] = [
  {
    id: 'del-1',
    event_id: 'evt-101-uuid',
    endpoint_id: 'ep-1',
    endpoint_url: 'https://api.example.com/order-hook',
    seq: 1,
    state: 'SUCCEEDED',
    attempt_count: 1,
    next_attempt_at: '2026-11-17T10:00:02.000Z',
    last_status_code: 200,
    created_at: '2026-11-17T10:00:01.000Z',
    updated_at: '2026-11-17T10:00:02.000Z',
  },
  {
    id: 'del-2',
    event_id: 'evt-101-uuid',
    endpoint_id: 'ep-2',
    endpoint_url: 'https://api.example.com/order-analytics',
    seq: 2,
    state: 'DEAD',
    attempt_count: 5,
    next_attempt_at: '2026-11-17T10:05:00.000Z',
    last_status_code: 500,
    created_at: '2026-11-17T10:00:01.000Z',
    updated_at: '2026-11-17T10:05:00.000Z',
  },
]

describe('EventsPage Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAppMode = 'live'
    mockGetDeliveries.mockResolvedValue(sampleDeliveries)
    mockGetEvents.mockResolvedValue({
      data: sampleEvents,
      pagination: {
        page: 1,
        pageSize: 20,
        totalRecords: 2,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      },
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders EventsPage and displays events table with correct columns and data', async () => {
    render(
      <MemoryRouter>
        <EventsPage />
      </MemoryRouter>
    )

    // Verify page title
    expect(screen.getByText('Event Explorer')).toBeDefined()

    // Wait for events to load
    await waitFor(() => {
      expect(screen.getByText(/evt-101/)).toBeDefined()
      expect(screen.getByText(/evt-102/)).toBeDefined()
    })

    // Verify event types
    expect(screen.getByText('order.created')).toBeDefined()
    expect(screen.getByText('user.signup')).toBeDefined()

    // Verify idempotency keys
    expect(screen.getByText('ik-order-101')).toBeDefined()
    expect(screen.getByText('ik-user-102')).toBeDefined()

    // Verify delivery outcome pills for evt-order-101
    expect(screen.getByText('2 total')).toBeDefined()
    expect(screen.getByText('1 ok')).toBeDefined()
    expect(screen.getByText('1 dead')).toBeDefined()

    // Verify evt-user-102 with 0 endpoints
    expect(screen.getByText('0 endpoints')).toBeDefined()
  })

  describe('Duplicate Request Prevention', () => {
    it('executes exactly ONE API request on initial mount', async () => {
      render(
        <MemoryRouter>
          <EventsPage />
        </MemoryRouter>
      )

      await waitFor(() => {
        expect(screen.getByText(/evt-101/)).toBeDefined()
      })

      expect(mockGetEvents).toHaveBeenCalledTimes(1)
      expect(mockGetEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 1,
          pageSize: 20,
        })
      )
    })

    it('executes exactly ONE API request on page navigation', async () => {
      mockGetEvents.mockResolvedValue({
        data: sampleEvents,
        pagination: {
          page: 1,
          pageSize: 20,
          totalRecords: 40,
          totalPages: 2,
          hasNext: true,
          hasPrev: false,
        },
      })

      render(
        <MemoryRouter>
          <EventsPage />
        </MemoryRouter>
      )

      await waitFor(() => {
        expect(mockGetEvents).toHaveBeenCalledTimes(1)
      })

      const nextBtn = screen.getByRole('button', { name: 'Go to next page' })
      await act(async () => {
        fireEvent.click(nextBtn)
      })

      await waitFor(() => {
        expect(mockGetEvents).toHaveBeenCalledTimes(2)
      })

      expect(mockGetEvents).toHaveBeenLastCalledWith(
        expect.objectContaining({
          page: 2,
          pageSize: 20,
        })
      )
    })

    it('executes exactly ONE API request on page size change', async () => {
      mockGetEvents.mockResolvedValue({
        data: sampleEvents,
        pagination: {
          page: 1,
          pageSize: 20,
          totalRecords: 50,
          totalPages: 3,
          hasNext: true,
          hasPrev: false,
        },
      })

      render(
        <MemoryRouter>
          <EventsPage />
        </MemoryRouter>
      )

      await waitFor(() => {
        expect(mockGetEvents).toHaveBeenCalledTimes(1)
      })

      const select = screen.getByLabelText(/select number of events per page/i)
      await act(async () => {
        fireEvent.change(select, { target: { value: '50' } })
      })

      await waitFor(() => {
        expect(mockGetEvents).toHaveBeenCalledTimes(2)
      })

      expect(mockGetEvents).toHaveBeenLastCalledWith(
        expect.objectContaining({
          page: 1,
          pageSize: 50,
        })
      )
    })

    it('executes exactly ONE API request when clearing all filters', async () => {
      render(
        <MemoryRouter>
          <EventsPage />
        </MemoryRouter>
      )

      await waitFor(() => {
        expect(mockGetEvents).toHaveBeenCalledTimes(1)
      })

      // Open filters and add idempotency filter
      fireEvent.click(screen.getByRole('button', { name: /filters/i }))
      const keyInput = screen.getByPlaceholderText(/exact idempotency key/i)
      await act(async () => {
        fireEvent.change(keyInput, { target: { value: 'ik-test' } })
      })

      await waitFor(() => {
        expect(mockGetEvents).toHaveBeenCalledTimes(2)
      })

      // Click Clear all filters
      const clearBtn = screen.getByRole('button', { name: /clear all filters/i })
      await act(async () => {
        fireEvent.click(clearBtn)
      })

      await waitFor(() => {
        expect(mockGetEvents).toHaveBeenCalledTimes(3)
      })

      expect(mockGetEvents).toHaveBeenLastCalledWith(
        expect.objectContaining({
          page: 1,
          pageSize: 20,
        })
      )
    })
  })

  describe('Date Range Validation', () => {
    it('displays inline validation alert and blocks reversed date request', async () => {
      render(
        <MemoryRouter>
          <EventsPage />
        </MemoryRouter>
      )

      await waitFor(() => {
        expect(mockGetEvents).toHaveBeenCalledTimes(1)
      })

      // Open filters
      fireEvent.click(screen.getByRole('button', { name: /filters/i }))

      const afterInput = screen.getByLabelText(/filter events created after date/i)
      const beforeInput = screen.getByLabelText(/filter events created before date/i)

      await act(async () => {
        fireEvent.change(afterInput, { target: { value: '2026-11-20' } })
        fireEvent.change(beforeInput, { target: { value: '2026-11-10' } })
      })

      expect(
        screen.getByText(/created after.*cannot be later than.*created before/i)
      ).toBeDefined()

      // Initial call was 1, setting after alone made call 2, setting reversed before blocked call 3
      expect(mockGetEvents).toHaveBeenCalledTimes(2)
    })
  })

  describe('Copy to Clipboard Interactions', () => {
    it('copies Event ID and shows visual feedback', async () => {
      const copySpy = vi.spyOn(formatters, 'copyToClipboard').mockResolvedValue(true)

      render(
        <MemoryRouter>
          <EventsPage />
        </MemoryRouter>
      )

      await waitFor(() => {
        expect(screen.getByText(/evt-101/)).toBeDefined()
      })

      const copyIdBtn = screen.getByRole('button', { name: /copy event id evt-101-uuid/i })
      await act(async () => {
        fireEvent.click(copyIdBtn)
      })

      expect(copySpy).toHaveBeenCalledWith('evt-101-uuid')
    })

    it('copies Idempotency Key and shows visual feedback', async () => {
      const copySpy = vi.spyOn(formatters, 'copyToClipboard').mockResolvedValue(true)

      render(
        <MemoryRouter>
          <EventsPage />
        </MemoryRouter>
      )

      await waitFor(() => {
        expect(screen.getByText('ik-order-101')).toBeDefined()
      })

      const copyKeyBtn = screen.getByRole('button', { name: /copy idempotency key ik-order-101/i })
      await act(async () => {
        fireEvent.click(copyKeyBtn)
      })

      expect(copySpy).toHaveBeenCalledWith('ik-order-101')
    })
  })

  describe('Error and Empty States', () => {
    it('displays error card on failure and retries gracefully', async () => {
      mockGetEvents.mockRejectedValueOnce(new Error('Gateway timeout 504'))

      render(
        <MemoryRouter>
          <EventsPage />
        </MemoryRouter>
      )

      await waitFor(() => {
        expect(screen.getByText('Failed to Load Events')).toBeDefined()
        expect(screen.getByText('Gateway timeout 504')).toBeDefined()
      })

      // Click Retry
      mockGetEvents.mockResolvedValueOnce({
        data: sampleEvents,
        pagination: {
          page: 1,
          pageSize: 20,
          totalRecords: 2,
          totalPages: 1,
          hasNext: false,
          hasPrev: false,
        },
      })

      const retryBtn = screen.getByRole('button', { name: /retry/i })
      await act(async () => {
        fireEvent.click(retryBtn)
      })

      await waitFor(() => {
        expect(screen.getByText(/evt-101/)).toBeDefined()
      })
    })

    it('displays empty state when 0 events exist in platform and provides Send Event CTA', async () => {
      mockGetEvents.mockResolvedValueOnce({
        data: [],
        pagination: {
          page: 1,
          pageSize: 20,
          totalRecords: 0,
          totalPages: 0,
          hasNext: false,
          hasPrev: false,
        },
      })

      render(
        <MemoryRouter>
          <EventsPage />
        </MemoryRouter>
      )

      await waitFor(() => {
        expect(screen.getByText('No Webhook Events Recorded')).toBeDefined()
        expect(screen.getByRole('button', { name: /send event/i })).toBeDefined()
      })
    })

    it('displays filter empty state when active filters match 0 events and provides Clear Filters CTA', async () => {
      mockGetEvents.mockResolvedValue({
        data: [],
        pagination: {
          page: 1,
          pageSize: 20,
          totalRecords: 0,
          totalPages: 0,
          hasNext: false,
          hasPrev: false,
        },
      })

      render(
        <MemoryRouter>
          <EventsPage />
        </MemoryRouter>
      )

      // Open filters and add filter
      fireEvent.click(screen.getByRole('button', { name: /filters/i }))
      const keyInput = screen.getByPlaceholderText(/exact idempotency key/i)
      await act(async () => {
        fireEvent.change(keyInput, { target: { value: 'non-existent' } })
      })

      await waitFor(() => {
        expect(screen.getByText('No Matching Events')).toBeDefined()
      })

      const clearBtn = screen.getAllByRole('button', { name: /clear filters/i })[0]
      await act(async () => {
        fireEvent.click(clearBtn)
      })

      expect(keyInput).toHaveProperty('value', '')
    })
  })

  describe('Modal and Drawer Workflows', () => {
    it('opens SendEventModal when clicking Send Test Event button', async () => {
      render(
        <MemoryRouter>
          <EventsPage />
        </MemoryRouter>
      )

      const sendBtn = screen.getByRole('button', { name: /send test event/i })
      await act(async () => {
        fireEvent.click(sendBtn)
      })

      expect(screen.getByText('Send Webhook Event')).toBeDefined()
    })

    it('opens EventDetailDrawer when clicking an event row and supports nested delivery inspection', async () => {
      render(
        <MemoryRouter>
          <EventsPage />
        </MemoryRouter>
      )

      await waitFor(() => {
        expect(screen.getByText(/evt-101/)).toBeDefined()
      })

      const row = screen.getByText(/evt-101/).closest('tr')!
      await act(async () => {
        fireEvent.click(row)
      })

      // Drawer opens with event inspection details
      await waitFor(() => {
        expect(screen.getByText('Event Inspection')).toBeDefined()
        expect(screen.getByText('Enqueued Deliveries (2)')).toBeDefined()
        expect(screen.getByText('https://api.example.com/order-hook')).toBeDefined()
      })

      // Click "Inspect" on the first nested delivery
      const inspectButtons = screen.getAllByRole('button', { name: /inspect/i })
      expect(inspectButtons.length).toBeGreaterThanOrEqual(1)

      await act(async () => {
        fireEvent.click(inspectButtons[0])
      })

      // DeliveryDetailDrawer should now be open
      await waitFor(() => {
        expect(screen.getByText('Delivery Inspector')).toBeDefined()
      })
    })
  })
})
