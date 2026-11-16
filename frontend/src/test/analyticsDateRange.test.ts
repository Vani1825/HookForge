import { describe, it, expect, vi, beforeEach } from 'vitest'
import { apiClient } from '../api/client'
import {
  fetchSystemMetrics,
  fetchTimeSeriesMetrics,
  fetchStatusDistribution,
  type MetricsQueryParams,
} from '../api/metrics'
import { mockStore } from '../mocks/mockStore'

vi.mock('../api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
}))

describe('Analytics Date-Range Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('API Client Parameter Serialization', () => {
    it('serializes 24h range parameters correctly', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        totalEvents: 50,
        totalDeliveries: 100,
        succeededDeliveries: 98,
        failedDeliveries: 2,
        pendingDeliveries: 0,
        successRate: 98.0,
        averageLatencyMs: 45,
        activeEndpoints: 3,
        totalEndpoints: 3,
        openCircuits: 0,
      })

      const params: MetricsQueryParams = {
        range: '24h',
        created_after: '2026-11-15T12:00:00.000Z',
        created_before: '2026-11-16T12:00:00.000Z',
      }

      await fetchSystemMetrics(params)

      expect(apiClient.get).toHaveBeenCalledWith('/metrics', {
        params: {
          range: '24h',
          created_after: '2026-11-15T12:00:00.000Z',
          created_before: '2026-11-16T12:00:00.000Z',
        },
      })
    })

    it('serializes 7d and 30d range parameters across timeseries and distribution endpoints', async () => {
      vi.mocked(apiClient.get).mockResolvedValue([])

      const params7d: MetricsQueryParams = {
        range: '7d',
        created_after: '2026-11-09T00:00:00.000Z',
        created_before: '2026-11-16T00:00:00.000Z',
      }

      await fetchTimeSeriesMetrics(params7d)

      expect(apiClient.get).toHaveBeenCalledWith('/metrics/timeseries', {
        params: params7d,
      })

      const params30d: MetricsQueryParams = {
        range: '30d',
        created_after: '2026-10-17T00:00:00.000Z',
        created_before: '2026-11-16T00:00:00.000Z',
      }

      await fetchStatusDistribution(params30d)

      expect(apiClient.get).toHaveBeenCalledWith('/metrics/distribution', {
        params: params30d,
      })
    })

    it('ensures overview, timeseries, and distribution receive consistent date boundaries', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({})

      const filter: MetricsQueryParams = {
        created_after: '2026-11-01T00:00:00.000Z',
        created_before: '2026-11-16T23:59:59.999Z',
        range: '30d',
      }

      await Promise.all([
        fetchSystemMetrics(filter),
        fetchTimeSeriesMetrics(filter),
        fetchStatusDistribution(filter),
      ])

      expect(apiClient.get).toHaveBeenNthCalledWith(1, '/metrics', { params: filter })
      expect(apiClient.get).toHaveBeenNthCalledWith(2, '/metrics/timeseries', { params: filter })
      expect(apiClient.get).toHaveBeenNthCalledWith(3, '/metrics/distribution', { params: filter })
    })

    it('propagates API errors in Live Mode without falling back to fabricated metrics', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('503 Service Unavailable: database overloaded'))

      await expect(fetchSystemMetrics({ range: '24h' })).rejects.toThrow('503 Service Unavailable')
      await expect(fetchTimeSeriesMetrics({ range: '24h' })).rejects.toThrow('503 Service Unavailable')
      await expect(fetchStatusDistribution({ range: '24h' })).rejects.toThrow('503 Service Unavailable')
    })
  })

  describe('MockStore Date-Range Filtering (Demo Mode)', () => {
    it('filters overview metrics within explicit date boundaries', () => {
      const now = Date.now()
      const futureMetrics = mockStore.getOverviewMetrics({
        created_after: new Date(now + 100000).toISOString(),
        created_before: new Date(now + 200000).toISOString(),
      })

      // In an empty future window, genuine 0s must be returned without NaN
      expect(futureMetrics.totalDeliveries).toBe(0)
      expect(futureMetrics.succeededDeliveries).toBe(0)
      expect(futureMetrics.failedDeliveries).toBe(0)
      expect(futureMetrics.totalEvents).toBe(0)
      expect(futureMetrics.successRate).toBe(100)
      expect(futureMetrics.averageLatencyMs).toBe(0)
    })

    it('returns daily time-series data points for 7d range', () => {
      const ts7d = mockStore.getTimeSeriesMetrics({ range: '7d' })
      expect(ts7d).toHaveLength(7)
      expect(ts7d[0]).toHaveProperty('label')
      expect(ts7d[0]).toHaveProperty('timestamp')
      expect(ts7d[0]).toHaveProperty('total')
      expect(ts7d[0]).toHaveProperty('succeeded')
    })

    it('returns 30 daily time-series data points for 30d range', () => {
      const ts30d = mockStore.getTimeSeriesMetrics({ range: '30d' })
      expect(ts30d).toHaveLength(30)
      expect(ts30d[29]).toHaveProperty('label')
      expect(ts30d[29]).toHaveProperty('timestamp')
    })

    it('returns distribution with genuine 0s when no deliveries match range', () => {
      const dist = mockStore.getStatusDistribution({
        created_after: new Date(Date.now() + 500000).toISOString(),
      })

      expect(dist).toHaveLength(5)
      expect(dist.every((d) => d.value === 0)).toBe(true)
    })
  })
})
