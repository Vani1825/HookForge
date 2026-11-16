import { describe, it, expect, vi, beforeEach } from 'vitest'
import { apiClient } from '../api/client'
import { fetchDeliveries } from '../api/deliveries'
import { fetchEvents } from '../api/events'
import { mockStore } from '../mocks/mockStore'

vi.mock('../api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
}))

describe('Frontend Pagination and Filters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Deliveries API Client', () => {
    it('handles default pagination when no parameters are provided', async () => {
      const mockRawDeliveries = [
        {
          id: 'del-1',
          event_id: 'ev-1',
          endpoint_id: 'ep-1',
          state: 'PENDING',
          seq: 1,
          attempt_count: 0,
          next_attempt_at: '2026-11-16T12:00:00Z',
          created_at: '2026-11-16T10:00:00Z',
          updated_at: '2026-11-16T10:00:00Z',
        },
      ]

      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockRawDeliveries,
        state: 'ALL',
        pagination: {
          page: 1,
          pageSize: 20,
          totalRecords: 1,
          totalPages: 1,
          hasNext: false,
          hasPrev: false,
        },
      })

      const res = await fetchDeliveries()

      expect(apiClient.get).toHaveBeenCalledWith('/deliveries', {
        params: { state: 'ALL' },
      })
      expect(res).toHaveLength(1)
      expect(res.data).toHaveLength(1)
      expect(res[0].id).toBe('del-1')
      expect(res.pagination).toEqual({
        page: 1,
        pageSize: 20,
        totalRecords: 1,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      })
    })

    it('passes page and pageSize and parses pagination envelope correctly', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [],
        pagination: {
          page: 2,
          pageSize: 10,
          totalRecords: 25,
          totalPages: 3,
          hasNext: true,
          hasPrev: true,
        },
      })

      const res = await fetchDeliveries({ page: 2, pageSize: 10, state: 'DEAD' })

      expect(apiClient.get).toHaveBeenCalledWith('/deliveries', {
        params: {
          page: 2,
          pageSize: 10,
          state: 'DEAD',
        },
      })
      expect(res.pagination.page).toBe(2)
      expect(res.pagination.pageSize).toBe(10)
      expect(res.pagination.totalRecords).toBe(25)
      expect(res.pagination.totalPages).toBe(3)
      expect(res.pagination.hasNext).toBe(true)
      expect(res.pagination.hasPrev).toBe(true)
    })

    it('supports combined filters: state, endpoint_id, event_id, date range, and q', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
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

      const params = {
        page: 1,
        pageSize: 20,
        state: 'SUCCEEDED',
        endpoint_id: 'ep-uuid-1',
        event_id: 'ev-uuid-1',
        created_after: '2026-11-01T00:00:00.000Z',
        created_before: '2026-11-15T23:59:59.999Z',
        q: 'timeout error',
      }

      const res = await fetchDeliveries(params)

      expect(apiClient.get).toHaveBeenCalledWith('/deliveries', {
        params: {
          page: 1,
          pageSize: 20,
          state: 'SUCCEEDED',
          endpoint_id: 'ep-uuid-1',
          event_id: 'ev-uuid-1',
          created_after: '2026-11-01T00:00:00.000Z',
          created_before: '2026-11-15T23:59:59.999Z',
          q: 'timeout error',
        },
      })
      expect(res).toHaveLength(0)
      expect(res.pagination.totalRecords).toBe(0)
    })

    it('normalizes legacy raw array response format with backward compatibility', async () => {
      const mockLegacyArray = [
        {
          id: 'del-legacy-1',
          eventId: 'ev-1',
          endpointId: 'ep-1',
          state: 'DEAD',
          attemptCount: 3,
          createdAt: '2026-11-16T10:00:00Z',
          updatedAt: '2026-11-16T10:05:00Z',
        },
      ]

      vi.mocked(apiClient.get).mockResolvedValue(mockLegacyArray)

      const res = await fetchDeliveries({ state: 'DEAD' })

      expect(res).toHaveLength(1)
      expect(res[0].id).toBe('del-legacy-1')
      expect(res[0].event_id).toBe('ev-1')
      expect(res[0].endpoint_id).toBe('ep-1')
      expect(res.pagination).toEqual({
        page: 1,
        pageSize: 1,
        totalRecords: 1,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      })
    })

    it('handles empty results properly', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
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

      const res = await fetchDeliveries({ state: 'DEAD' })

      expect(res).toHaveLength(0)
      expect(res.pagination.totalRecords).toBe(0)
      expect(res.pagination.totalPages).toBe(0)
      expect(res.pagination.hasNext).toBe(false)
      expect(res.pagination.hasPrev).toBe(false)
    })

    it('propagates API errors without falling back to mock data', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('Network error: 500 Internal Server Error'))

      await expect(fetchDeliveries()).rejects.toThrow('Network error: 500 Internal Server Error')
    })
  })

  describe('Events API Client', () => {
    it('handles default pagination when fetching events', async () => {
      const mockRawEvents = [
        {
          id: 'ev-1',
          tenant_id: 'tenant-1',
          idempotency_key: 'idemp-1',
          created_at: '2026-11-16T10:00:00Z',
          payload: { orderId: 101 },
        },
      ]

      vi.mocked(apiClient.get).mockResolvedValue({
        data: mockRawEvents,
        pagination: {
          page: 1,
          pageSize: 20,
          totalRecords: 1,
          totalPages: 1,
          hasNext: false,
          hasPrev: false,
        },
      })

      const res = await fetchEvents()

      expect(apiClient.get).toHaveBeenCalledWith('/events', { params: {} })
      expect(res).toHaveLength(1)
      expect(res[0].id).toBe('ev-1')
      expect(res.pagination).toEqual({
        page: 1,
        pageSize: 20,
        totalRecords: 1,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      })
    })

    it('supports moving between pages for events', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [],
        pagination: {
          page: 3,
          pageSize: 10,
          totalRecords: 35,
          totalPages: 4,
          hasNext: true,
          hasPrev: true,
        },
      })

      const res = await fetchEvents({ page: 3, pageSize: 10 })

      expect(apiClient.get).toHaveBeenCalledWith('/events', {
        params: { page: 3, pageSize: 10 },
      })
      expect(res.pagination.page).toBe(3)
      expect(res.pagination.totalPages).toBe(4)
      expect(res.pagination.hasNext).toBe(true)
      expect(res.pagination.hasPrev).toBe(true)
    })

    it('supports event filters: idempotency_key, dates, and q', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
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

      const params = {
        page: 1,
        pageSize: 20,
        idempotency_key: 'unique-idemp-key',
        created_after: '2026-11-01T00:00:00.000Z',
        created_before: '2026-11-16T23:59:59.999Z',
        q: 'order.created',
      }

      await fetchEvents(params)

      expect(apiClient.get).toHaveBeenCalledWith('/events', {
        params: {
          page: 1,
          pageSize: 20,
          idempotency_key: 'unique-idemp-key',
          created_after: '2026-11-01T00:00:00.000Z',
          created_before: '2026-11-16T23:59:59.999Z',
          q: 'order.created',
        },
      })
    })

    it('normalizes legacy raw array response format for events', async () => {
      const mockRawEvents = [
        {
          id: 'ev-legacy',
          tenantId: 'tenant-1',
          idempotencyKey: 'idemp-legacy',
          createdAt: '2026-11-16T10:00:00Z',
          payload: { action: 'ping' },
        },
      ]

      vi.mocked(apiClient.get).mockResolvedValue(mockRawEvents)

      const res = await fetchEvents()

      expect(res).toHaveLength(1)
      expect(res[0].id).toBe('ev-legacy')
      expect(res[0].idempotency_key).toBe('idemp-legacy')
      expect(res.pagination.page).toBe(1)
      expect(res.pagination.totalRecords).toBe(1)
    })

    it('propagates API failures for events without fallback', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('Backend connection refused'))

      await expect(fetchEvents()).rejects.toThrow('Backend connection refused')
    })
  })

  describe('MockStore Pagination and Filters', () => {
    it('slices deliveries according to page and pageSize in demo mode', () => {
      const resPage1 = mockStore.getDeliveries({ page: 1, pageSize: 2 })
      expect(resPage1).toHaveLength(2)
      expect(resPage1.pagination.page).toBe(1)
      expect(resPage1.pagination.pageSize).toBe(2)
      expect(resPage1.pagination.totalRecords).toBeGreaterThanOrEqual(2)
      expect(resPage1.pagination.hasNext).toBe(true)
      expect(resPage1.pagination.hasPrev).toBe(false)

      const resPage2 = mockStore.getDeliveries({ page: 2, pageSize: 2 })
      expect(resPage2).toHaveLength(2)
      expect(resPage2.pagination.page).toBe(2)
      expect(resPage2.pagination.hasPrev).toBe(true)
      // Deliveries on page 2 should be different from page 1
      expect(resPage2[0].id).not.toBe(resPage1[0].id)
    })

    it('filters deliveries by state in demo mode', () => {
      const deadLetters = mockStore.getDeliveries({ state: 'DEAD' })
      expect(deadLetters.every((d) => d.state === 'DEAD')).toBe(true)
    })

    it('slices events according to page and pageSize in demo mode', () => {
      const eventsPage1 = mockStore.getEvents({ page: 1, pageSize: 1 })
      expect(eventsPage1).toHaveLength(1)
      expect(eventsPage1.pagination.page).toBe(1)
      expect(eventsPage1.pagination.pageSize).toBe(1)
      expect(eventsPage1.pagination.hasNext).toBe(true)
    })

    it('filters events by search query q in demo mode', () => {
      const allEvents = mockStore.getEvents()
      if (allEvents.length > 0) {
        const first = allEvents[0]
        const matched = mockStore.getEvents({ q: first.id })
        expect(matched.some((e) => e.id === first.id)).toBe(true)
      }
    })
  })
})
