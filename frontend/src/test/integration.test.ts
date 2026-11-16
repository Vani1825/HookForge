import { describe, it, expect, vi, beforeEach } from 'vitest'
import { apiClient } from '../api/client'
import { replayDelivery } from '../api/deliveries'
import { ingestEvent } from '../api/events'
import { fetchEndpointById } from '../api/endpoints'
import { fetchSystemMetrics, fetchTimeSeriesMetrics, fetchStatusDistribution } from '../api/metrics'

vi.mock('../api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
}))

describe('Frontend-Backend Integration APIs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('replayDelivery contract alignment', () => {
    it('handles new wrapped response format { success, message, delivery }', async () => {
      const mockRawDelivery = {
        id: 'del-123',
        event_id: 'ev-1',
        endpoint_id: 'ep-1',
        state: 'PENDING',
        seq: 1,
        attempt_count: 2,
        next_attempt_at: '2026-11-14T12:00:00Z',
        created_at: '2026-11-14T10:00:00Z',
        updated_at: '2026-11-14T12:00:00Z',
      }
      vi.mocked(apiClient.post).mockResolvedValue({
        success: true,
        message: 'Delivery re-enqueued as PENDING',
        delivery: mockRawDelivery,
        ...mockRawDelivery,
      })

      const result = await replayDelivery('del-123')

      expect(apiClient.post).toHaveBeenCalledWith('/deliveries/del-123/replay')
      expect(result.success).toBe(true)
      expect(result.delivery?.id).toBe('del-123')
      expect(result.delivery?.state).toBe('PENDING')
    })

    it('handles legacy raw delivery response format gracefully', async () => {
      const mockLegacyDelivery = {
        id: 'del-legacy',
        eventId: 'ev-legacy',
        endpointId: 'ep-legacy',
        state: 'PENDING',
        seq: 1,
        attemptCount: 1,
        createdAt: '2026-11-14T10:00:00Z',
        updatedAt: '2026-11-14T12:00:00Z',
      }
      vi.mocked(apiClient.post).mockResolvedValue(mockLegacyDelivery)

      const result = await replayDelivery('del-legacy')

      expect(result.success).toBe(true)
      expect(result.delivery?.id).toBe('del-legacy')
      expect(result.delivery?.event_id).toBe('ev-legacy')
    })
  })

  describe('ingestEvent duplicate handling', () => {
    it('returns duplicate: false and deliveriesEnqueued for new events (202)', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        id: 'ev-new',
        eventId: 'ev-new',
        deliveriesEnqueued: 3,
        duplicate: false,
      })

      const res = await ingestEvent({
        idempotency_key: 'key-123',
        payload: { test: true },
      })

      expect(apiClient.post).toHaveBeenCalledWith(
        '/events',
        { test: true },
        { headers: { 'Idempotency-Key': 'key-123' } }
      )
      expect(res.duplicate).toBe(false)
      expect(res.deliveriesEnqueued).toBe(3)
      expect(res.eventId).toBe('ev-new')
    })

    it('returns duplicate: true and 0 deliveries for idempotent replays (200)', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        id: 'ev-dup',
        eventId: 'ev-dup',
        deliveriesEnqueued: 0,
        duplicate: true,
      })

      const res = await ingestEvent({
        idempotency_key: 'key-123',
        payload: { test: true },
      })

      expect(res.duplicate).toBe(true)
      expect(res.deliveriesEnqueued).toBe(0)
    })
  })

  describe('fetchEndpointById', () => {
    it('normalizes response fields from backend GET /endpoints/:id', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        id: 'ep-uuid-1',
        url: 'https://example.com/webhook',
        active: true,
        rateLimitRps: 25,
        circuitState: 'CLOSED',
        consecutiveFailures: 0,
        nextSeq: 5,
        createdAt: '2026-11-14T10:00:00Z',
      })

      const ep = await fetchEndpointById('ep-uuid-1')

      expect(apiClient.get).toHaveBeenCalledWith('/endpoints/ep-uuid-1')
      expect(ep.id).toBe('ep-uuid-1')
      expect(ep.rate_limit_rps).toBe(25)
      expect(ep.circuit_state).toBe('CLOSED')
    })
  })

  describe('metrics API integration', () => {
    it('fetches system metrics from /metrics', async () => {
      const mockMetrics = {
        totalEvents: 50,
        totalDeliveries: 100,
        succeededDeliveries: 98,
        failedDeliveries: 2,
        pendingDeliveries: 0,
        successRate: 98.0,
        averageLatencyMs: 42,
        activeEndpoints: 3,
        totalEndpoints: 3,
        openCircuits: 0,
      }
      vi.mocked(apiClient.get).mockResolvedValue(mockMetrics)

      const result = await fetchSystemMetrics()

      expect(apiClient.get).toHaveBeenCalledWith('/metrics')
      expect(result.averageLatencyMs).toBe(42)
    })

    it('fetches timeseries from /metrics/timeseries', async () => {
      const mockPoints = [
        { timestamp: '10:00', label: '10 AM', total: 10, succeeded: 10, failed: 0, pending: 0 },
      ]
      vi.mocked(apiClient.get).mockResolvedValue(mockPoints)

      const result = await fetchTimeSeriesMetrics()

      expect(apiClient.get).toHaveBeenCalledWith('/metrics/timeseries')
      expect(result).toEqual(mockPoints)
    })

    it('fetches distribution from /metrics/distribution', async () => {
      const mockDist = [{ name: 'Succeeded', value: 10, color: '#10b981' }]
      vi.mocked(apiClient.get).mockResolvedValue(mockDist)

      const result = await fetchStatusDistribution()

      expect(apiClient.get).toHaveBeenCalledWith('/metrics/distribution')
      expect(result).toEqual(mockDist)
    })
  })
})
