// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DeliveriesPage } from '../pages/DeliveriesPage'
import type { Delivery, Endpoint } from '../types'
import * as formatters from '../utils/formatters'

const mockGetDeliveries = vi.fn()
const mockGetDeliveryById = vi.fn()
const mockReplayDelivery = vi.fn()
const mockGetEndpoints = vi.fn()
const mockAddToast = vi.fn()

const mockService = {
  getDeliveries: mockGetDeliveries,
  getDeliveryById: mockGetDeliveryById,
  replayDelivery: mockReplayDelivery,
  getEndpoints: mockGetEndpoints,
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

const sampleDeliveries: Delivery[] = [
  {
    id: 'del-101-uuid',
    event_id: 'evt-201-uuid',
    endpoint_id: 'ep-301-uuid',
    endpoint_url: 'https://api.hookforge.dev/webhook',
    seq: 1,
    state: 'SUCCEEDED',
    attempt_count: 1,
    next_attempt_at: '2026-11-17T10:00:00.000Z',
    last_status_code: 200,
    created_at: '2026-11-17T10:00:00.000Z',
    updated_at: '2026-11-17T10:00:02.000Z',
  },
  {
    id: 'del-102-uuid',
    event_id: 'evt-202-uuid',
    endpoint_id: 'ep-302-uuid',
    endpoint_url: 'https://api.hookforge.dev/fail',
    seq: 2,
    state: 'DEAD',
    attempt_count: 5,
    next_attempt_at: '2026-11-17T10:10:00.000Z',
    last_status_code: 500,
    last_error: 'Server timeout after 5000ms',
    created_at: '2026-11-17T10:05:00.000Z',
    updated_at: '2026-11-17T10:10:00.000Z',
  },
  {
    id: 'del-103-uuid',
    event_id: 'evt-203-uuid',
    endpoint_id: 'ep-301-uuid',
    endpoint_url: 'https://api.hookforge.dev/webhook',
    seq: 3,
    state: 'RETRYING',
    attempt_count: 2,
    next_attempt_at: '2026-11-17T11:00:00.000Z',
    last_status_code: 429,
    created_at: '2026-11-17T10:15:00.000Z',
    updated_at: '2026-11-17T10:16:00.000Z',
  },
]

const sampleEndpoints: Endpoint[] = [
  {
    id: 'ep-301-uuid',
    tenant_id: 'tenant-1',
    url: 'https://api.hookforge.dev/webhook',
    active: true,
    rate_limit_rps: 50,
    circuit_state: 'CLOSED',
    consecutive_failures: 0,
    created_at: '2026-11-01T00:00:00Z',
  },
  {
    id: 'ep-302-uuid',
    tenant_id: 'tenant-1',
    url: 'https://api.hookforge.dev/fail',
    active: true,
    rate_limit_rps: 10,
    circuit_state: 'OPEN',
    consecutive_failures: 5,
    created_at: '2026-11-01T00:00:00Z',
  },
]

describe('DeliveriesPage Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAppMode = 'live'
    mockGetEndpoints.mockResolvedValue(sampleEndpoints)
    mockGetDeliveries.mockResolvedValue({
      data: sampleDeliveries,
      pagination: {
        page: 1,
        pageSize: 20,
        totalRecords: 3,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      },
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders DeliveriesPage and displays deliveries table with correct columns and data', async () => {
    render(
      <MemoryRouter>
        <DeliveriesPage />
      </MemoryRouter>
    )

    // Verify page header
    expect(screen.getByText('Delivery Pipeline Monitor')).toBeDefined()

    // Wait for deliveries to display
    await waitFor(() => {
      expect(screen.getByText(/del-101/)).toBeDefined()
      expect(screen.getByText(/del-102/)).toBeDefined()
      expect(screen.getByText(/del-103/)).toBeDefined()
    })

    // Verify status codes and badges
    expect(screen.getByText('200')).toBeDefined()
    expect(screen.getByText('500')).toBeDefined()
    expect(screen.getByText('429')).toBeDefined()

    // Verify sequence and attempt numbers
    expect(screen.getAllByText('#1').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('#2').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('#3').length).toBeGreaterThanOrEqual(1)
  })

  describe('Duplicate Request Prevention (Critical Bug Fix)', () => {
    it('executes exactly ONE API request on initial page mount', async () => {
      render(
        <MemoryRouter>
          <DeliveriesPage />
        </MemoryRouter>
      )

      await waitFor(() => {
        expect(screen.getByText(/del-101/)).toBeDefined()
      })

      // Must be called exactly ONCE on mount
      expect(mockGetDeliveries).toHaveBeenCalledTimes(1)
      expect(mockGetDeliveries).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 1,
          pageSize: 20,
          state: 'ALL',
        })
      )
    })

    it('executes exactly ONE API request when changing pages (no duplicate fetch)', async () => {
      mockGetDeliveries.mockResolvedValue({
        data: sampleDeliveries,
        pagination: {
          page: 1,
          pageSize: 20,
          totalRecords: 60,
          totalPages: 3,
          hasNext: true,
          hasPrev: false,
        },
      })

      render(
        <MemoryRouter>
          <DeliveriesPage />
        </MemoryRouter>
      )

      await waitFor(() => {
        expect(mockGetDeliveries).toHaveBeenCalledTimes(1)
      })

      // Click "Next" button
      const nextBtn = screen.getByRole('button', { name: 'Go to next page' })
      expect(nextBtn.getAttribute('disabled')).toBeNull()

      await act(async () => {
        fireEvent.click(nextBtn)
      })

      // Must be called exactly 2 times total (1 initial + 1 on page change)
      await waitFor(() => {
        expect(mockGetDeliveries).toHaveBeenCalledTimes(2)
      })

      expect(mockGetDeliveries).toHaveBeenLastCalledWith(
        expect.objectContaining({
          page: 2,
          pageSize: 20,
        })
      )
    })

    it('executes exactly ONE API request when changing page size', async () => {
      mockGetDeliveries.mockResolvedValue({
        data: sampleDeliveries,
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
          <DeliveriesPage />
        </MemoryRouter>
      )

      await waitFor(() => {
        expect(mockGetDeliveries).toHaveBeenCalledTimes(1)
      })

      // Change page size to 50
      const select = screen.getByLabelText(/select number of deliveries per page/i)
      await act(async () => {
        fireEvent.change(select, { target: { value: '50' } })
      })

      // Must be called exactly 2 times total (1 initial + 1 on size change)
      await waitFor(() => {
        expect(mockGetDeliveries).toHaveBeenCalledTimes(2)
      })

      expect(mockGetDeliveries).toHaveBeenLastCalledWith(
        expect.objectContaining({
          page: 1,
          pageSize: 50,
        })
      )
    })

    it('executes exactly ONE API request when selecting a state filter', async () => {
      render(
        <MemoryRouter>
          <DeliveriesPage />
        </MemoryRouter>
      )

      await waitFor(() => {
        expect(mockGetDeliveries).toHaveBeenCalledTimes(1)
      })

      // Change state filter to DEAD
      const stateSelect = screen.getByLabelText(/filter deliveries by state/i)
      await act(async () => {
        fireEvent.change(stateSelect, { target: { value: 'DEAD' } })
      })

      await waitFor(() => {
        expect(mockGetDeliveries).toHaveBeenCalledTimes(2)
      })

      expect(mockGetDeliveries).toHaveBeenLastCalledWith(
        expect.objectContaining({
          state: 'DEAD',
          page: 1,
        })
      )
    })

    it('executes exactly ONE API request when clicking Refresh', async () => {
      render(
        <MemoryRouter>
          <DeliveriesPage />
        </MemoryRouter>
      )

      await waitFor(() => {
        expect(mockGetDeliveries).toHaveBeenCalledTimes(1)
      })

      const refreshBtn = screen.getByRole('button', { name: /refresh deliveries list/i })
      await act(async () => {
        fireEvent.click(refreshBtn)
      })

      await waitFor(() => {
        expect(mockGetDeliveries).toHaveBeenCalledTimes(2)
      })
    })

    it('executes exactly ONE API request when clearing all filters', async () => {
      render(
        <MemoryRouter>
          <DeliveriesPage />
        </MemoryRouter>
      )

      await waitFor(() => {
        expect(mockGetDeliveries).toHaveBeenCalledTimes(1)
      })

      // Set state filter first
      const stateSelect = screen.getByLabelText(/filter deliveries by state/i)
      await act(async () => {
        fireEvent.change(stateSelect, { target: { value: 'DEAD' } })
      })

      await waitFor(() => {
        expect(mockGetDeliveries).toHaveBeenCalledTimes(2)
      })

      // Clear all filters
      const clearBtn = screen.getByRole('button', { name: /clear all filters/i })
      await act(async () => {
        fireEvent.click(clearBtn)
      })

      await waitFor(() => {
        expect(mockGetDeliveries).toHaveBeenCalledTimes(3)
      })

      expect(mockGetDeliveries).toHaveBeenLastCalledWith(
        expect.objectContaining({
          state: 'ALL',
          page: 1,
        })
      )
    })
  })

  describe('Date Range Validation', () => {
    it('displays inline validation alert and prevents sending invalid reversed date queries', async () => {
      render(
        <MemoryRouter>
          <DeliveriesPage />
        </MemoryRouter>
      )

      await waitFor(() => {
        expect(mockGetDeliveries).toHaveBeenCalledTimes(1)
      })

      // Open advanced filters
      const filtersToggle = screen.getByRole('button', { name: /filters/i })
      fireEvent.click(filtersToggle)

      const afterInput = screen.getByLabelText(/filter deliveries created after date/i)
      const beforeInput = screen.getByLabelText(/filter deliveries created before date/i)

      // Enter reversed dates: after is Nov 20, before is Nov 10
      await act(async () => {
        fireEvent.change(afterInput, { target: { value: '2026-11-20' } })
        fireEvent.change(beforeInput, { target: { value: '2026-11-10' } })
      })

      // Alert should be displayed
      expect(
        screen.getByText(/created after.*cannot be later than.*created before/i)
      ).toBeDefined()

      // Initial call was 1, setting after alone fired call 2, setting reversed before blocked call 3
      expect(mockGetDeliveries).toHaveBeenCalledTimes(2)
    })
  })

  describe('Error and Retry States', () => {
    it('displays error card on API failure and retries on demand', async () => {
      mockGetDeliveries.mockRejectedValueOnce(new Error('Connection timeout to PostgreSQL'))

      render(
        <MemoryRouter>
          <DeliveriesPage />
        </MemoryRouter>
      )

      await waitFor(() => {
        expect(screen.getByText('Failed to Load Deliveries')).toBeDefined()
        expect(screen.getByText('Connection timeout to PostgreSQL')).toBeDefined()
      })

      // Click Retry button
      mockGetDeliveries.mockResolvedValueOnce({
        data: sampleDeliveries,
        pagination: {
          page: 1,
          pageSize: 20,
          totalRecords: 3,
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
        expect(screen.getByText(/del-101/)).toBeDefined()
      })
    })
  })

  describe('Empty States', () => {
    it('displays initial empty state when no deliveries exist in platform', async () => {
      mockGetDeliveries.mockResolvedValueOnce({
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
          <DeliveriesPage />
        </MemoryRouter>
      )

      await waitFor(() => {
        expect(screen.getByText('No Deliveries in Queue')).toBeDefined()
        expect(
          screen.getByText(/webhook delivery tasks will appear here/i)
        ).toBeDefined()
      })
    })

    it('displays filter empty state when active filters match 0 records and allows clearing', async () => {
      mockGetDeliveries.mockResolvedValue({
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
          <DeliveriesPage />
        </MemoryRouter>
      )

      // Apply state filter
      const stateSelect = screen.getByLabelText(/filter deliveries by state/i)
      await act(async () => {
        fireEvent.change(stateSelect, { target: { value: 'DEAD' } })
      })

      await waitFor(() => {
        expect(screen.getByText('No Matching Deliveries')).toBeDefined()
      })

      // Click Clear Filters in empty state
      const clearBtn = screen.getAllByRole('button', { name: /clear filters/i })[0]
      await act(async () => {
        fireEvent.click(clearBtn)
      })

      expect(stateSelect).toHaveProperty('value', 'ALL')
    })
  })

  describe('Copy to Clipboard Interaction', () => {
    it('copies delivery ID and displays temporary checkmark feedback', async () => {
      const copySpy = vi.spyOn(formatters, 'copyToClipboard').mockResolvedValue(true)

      render(
        <MemoryRouter>
          <DeliveriesPage />
        </MemoryRouter>
      )

      await waitFor(() => {
        expect(screen.getByText(/del-101/)).toBeDefined()
      })

      const copyBtn = screen.getByRole('button', { name: /copy delivery id del-101-uuid/i })
      await act(async () => {
        fireEvent.click(copyBtn)
      })

      expect(copySpy).toHaveBeenCalledWith('del-101-uuid')
    })
  })

  describe('Dead Letter Replay & Drawer Integration', () => {
    it('provides a direct Replay button in the row for DEAD deliveries', async () => {
      render(
        <MemoryRouter>
          <DeliveriesPage />
        </MemoryRouter>
      )

      await waitFor(() => {
        expect(screen.getByText(/del-102/)).toBeDefined()
      })

      const replayBtn = screen.getByRole('button', { name: /replay dead delivery del-102-uuid/i })
      expect(replayBtn).toBeDefined()

      // Click replay button opens ReplayModal
      await act(async () => {
        fireEvent.click(replayBtn)
      })

      expect(screen.getByText('Confirm Delivery Replay')).toBeDefined()
      expect(screen.getByText('Ordering Guarantee Notice')).toBeDefined()
    })

    it('opens DeliveryDetailDrawer when clicking a delivery row', async () => {
      mockGetDeliveryById.mockResolvedValueOnce(sampleDeliveries[0])

      render(
        <MemoryRouter>
          <DeliveriesPage />
        </MemoryRouter>
      )

      await waitFor(() => {
        expect(screen.getByText(/del-101/)).toBeDefined()
      })

      const row = screen.getByText(/del-101/).closest('tr')!
      await act(async () => {
        fireEvent.click(row)
      })

      await waitFor(() => {
        expect(screen.getByText('Delivery Inspector')).toBeDefined()
      })
    })
  })
})
