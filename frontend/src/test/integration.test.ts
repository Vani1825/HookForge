import { describe, it, expect, vi, beforeEach } from 'vitest'
import { apiClient } from '../api/client'
import { replayDelivery, resendDelivery, normalizeAttempt } from '../api/deliveries'
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

  describe('resendDelivery contract alignment (Tanvi Phase 2)', () => {
    it('sends POST to /deliveries/:id/resend with immediate: false by default', async () => {
      const mockDelivery = {
        id: 'del-resend-1',
        eventId: 'ev-1',
        endpointId: 'ep-1',
        state: 'PENDING',
        seq: 1,
        attemptCount: 0,
        createdAt: '2026-11-20T10:00:00Z',
        updatedAt: '2026-11-20T10:05:00Z',
      }

      vi.mocked(apiClient.post).mockResolvedValue({
        success: true,
        message: 'Delivery queued for resend',
        delivery: mockDelivery,
      })

      const result = await resendDelivery('del-resend-1')

      expect(apiClient.post).toHaveBeenCalledWith('/deliveries/del-resend-1/resend', {
        immediate: false,
      })
      expect(result.success).toBe(true)
      expect(result.delivery?.id).toBe('del-resend-1')
      expect(result.delivery?.state).toBe('PENDING')
    })

    it('sends POST to /deliveries/:id/resend with immediate: true and normalizes attempt', async () => {
      const mockDelivery = {
        id: 'del-resend-2',
        eventId: 'ev-1',
        endpointId: 'ep-1',
        state: 'SUCCEEDED',
        seq: 1,
        attemptCount: 2,
        lastStatusCode: 200,
        createdAt: '2026-11-20T10:00:00Z',
        updatedAt: '2026-11-20T10:05:00Z',
      }
      const mockAttempt = {
        id: 'att-resend-1',
        deliveryId: 'del-resend-2',
        attemptNo: 2,
        startedAt: '2026-11-20T10:05:00Z',
        statusCode: 200,
        latencyMs: 50,
        requestHeaders: { 'Content-Type': 'application/json', 'X-Webhook-Signature': '[REDACTED]' },
        responseHeaders: { 'content-type': 'application/json' },
        responseBody: '{"ok":true}',
      }

      vi.mocked(apiClient.post).mockResolvedValue({
        success: true,
        message: 'Delivery resent immediately',
        delivery: mockDelivery,
        attempt: mockAttempt,
      })

      const result = await resendDelivery('del-resend-2', { immediate: true })

      expect(apiClient.post).toHaveBeenCalledWith('/deliveries/del-resend-2/resend', {
        immediate: true,
      })
      expect(result.success).toBe(true)
      expect(result.delivery?.state).toBe('SUCCEEDED')
      expect(result.attempt?.statusCode).toBe(200)
      expect(result.attempt?.requestHeaders?.['X-Webhook-Signature']).toBe('[REDACTED]')
      expect(result.attempt?.responseBody).toBe('{"ok":true}')
    })

    it('normalizeAttempt preserves request headers from snake_case and camelCase', () => {
      const snakeCaseAttempt = normalizeAttempt({
        id: 'att-1',
        delivery_id: 'del-1',
        attempt_no: 1,
        started_at: '2026-11-20T10:00:00Z',
        status_code: 200,
        latency_ms: 100,
        request_headers: { 'X-Custom-Header': 'val-1' },
        response_headers: { 'Server': 'nginx' },
        response_body: '{"status":"ok"}',
      })

      expect(snakeCaseAttempt.request_headers).toEqual({ 'X-Custom-Header': 'val-1' })
      expect(snakeCaseAttempt.requestHeaders).toEqual({ 'X-Custom-Header': 'val-1' })
      expect(snakeCaseAttempt.response_headers).toEqual({ 'Server': 'nginx' })

      const camelCaseAttempt = normalizeAttempt({
        id: 'att-2',
        deliveryId: 'del-2',
        attemptNumber: 2,
        attemptedAt: '2026-11-20T10:05:00Z',
        statusCode: 500,
        latencyMs: 120,
        requestHeaders: { 'Authorization': '[REDACTED]' },
        responseHeaders: { 'Content-Type': 'application/json' },
        responseBody: '{"error":"bad"}',
      })

      expect(camelCaseAttempt.request_headers).toEqual({ 'Authorization': '[REDACTED]' })
      expect(camelCaseAttempt.requestHeaders).toEqual({ 'Authorization': '[REDACTED]' })
      expect(camelCaseAttempt.statusCode).toBe(500)
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
