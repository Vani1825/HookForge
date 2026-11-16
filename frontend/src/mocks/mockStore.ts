import type {
  Endpoint,
  WebhookEvent,
  Delivery,
  DeliveryAttempt,
  OverviewMetrics,
  TimeSeriesDataPoint,
  StatusDistribution,
  PaginationMeta,
} from '../types'
import { createPaginatedList, type PaginatedList, type DeliveryQueryParams } from '../api/deliveries'
import type { EventQueryParams } from '../api/events'
import type { MetricsQueryParams } from '../api/metrics'
import {
  MOCK_TENANT,
  INITIAL_MOCK_ENDPOINTS,
  INITIAL_MOCK_EVENTS,
  INITIAL_MOCK_DELIVERIES,
  INITIAL_MOCK_ATTEMPTS,
  MOCK_TIME_SERIES,
} from './mockData'

class MockStore {
  private endpoints: Endpoint[] = [...INITIAL_MOCK_ENDPOINTS]
  private events: WebhookEvent[] = [...INITIAL_MOCK_EVENTS]
  private deliveries: Delivery[] = [...INITIAL_MOCK_DELIVERIES]
  private attempts: Record<string, DeliveryAttempt[]> = { ...INITIAL_MOCK_ATTEMPTS }

  // --- Endpoints ---
  getEndpoints(): Endpoint[] {
    return [...this.endpoints]
  }

  getEndpoint(id: string): Endpoint | undefined {
    return this.endpoints.find((e) => e.id === id)
  }

  createEndpoint(data: { url: string; rate_limit_rps?: number; description?: string }): Endpoint {
    const randomHex = Array.from({ length: 32 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join('')

    const newEndpoint: Endpoint = {
      id: `e1000000-0000-0000-0000-${Math.floor(100000000000 + Math.random() * 900000000000)}`,
      tenant_id: MOCK_TENANT.id,
      url: data.url,
      secret: `whsec_${randomHex}`,
      active: true,
      rate_limit_rps: data.rate_limit_rps || 10,
      next_seq: 1,
      circuit_state: 'CLOSED',
      circuit_until: null,
      consecutive_failures: 0,
      created_at: new Date().toISOString(),
      description: data.description || 'Webhook destination',
      total_deliveries: 0,
      success_rate: 100,
    }

    this.endpoints.unshift(newEndpoint)
    return newEndpoint
  }

  updateEndpoint(id: string, updates: Partial<Endpoint>): Endpoint | null {
    const idx = this.endpoints.findIndex((e) => e.id === id)
    if (idx === -1) return null

    this.endpoints[idx] = {
      ...this.endpoints[idx],
      ...updates,
    }
    return this.endpoints[idx]
  }

  toggleEndpoint(id: string): Endpoint | null {
    const endpoint = this.getEndpoint(id)
    if (!endpoint) return null
    return this.updateEndpoint(id, { active: !endpoint.active })
  }

  // --- Events ---
  getEvents(filter?: EventQueryParams): PaginatedList<WebhookEvent> {
    let result = [...this.events]

    if (filter?.idempotency_key) {
      result = result.filter((e) => e.idempotency_key === filter.idempotency_key)
    }

    if (filter?.created_after) {
      const after = new Date(filter.created_after).getTime()
      result = result.filter((e) => new Date(e.created_at).getTime() >= after)
    }

    if (filter?.created_before) {
      const before = new Date(filter.created_before).getTime()
      result = result.filter((e) => new Date(e.created_at).getTime() <= before)
    }

    if (filter?.q) {
      const q = filter.q.toLowerCase()
      result = result.filter(
        (e) =>
          e.id.toLowerCase().includes(q) ||
          e.idempotency_key.toLowerCase().includes(q)
      )
    }

    const totalRecords = result.length
    const page = Math.max(1, filter?.page || 1)
    const pageSize = Math.min(100, Math.max(1, filter?.pageSize || filter?.limit || 20))
    const totalPages = totalRecords === 0 ? 0 : Math.ceil(totalRecords / pageSize)
    const offset = filter?.offset !== undefined && filter?.page === undefined ? Math.max(0, filter.offset) : (page - 1) * pageSize
    const sliced = result.slice(offset, offset + pageSize)

    const pagination: PaginationMeta = {
      page,
      pageSize,
      totalRecords,
      totalPages,
      hasNext: offset + pageSize < totalRecords,
      hasPrev: totalRecords > 0 && offset > 0,
      ...(filter?.offset !== undefined && filter?.page === undefined ? { offset } : {}),
    }

    return createPaginatedList(sliced, pagination)
  }

  getEvent(id: string): WebhookEvent | undefined {
    return this.events.find((e) => e.id === id)
  }

  ingestEvent(data: { idempotency_key: string; payload: Record<string, unknown>; event_type?: string }): {
    duplicate: boolean
    deliveriesEnqueued: number
    eventId?: string
  } {
    // 1. Check idempotency key uniqueness
    const existing = this.events.find((e) => e.idempotency_key === data.idempotency_key)
    if (existing) {
      return { duplicate: true, deliveriesEnqueued: 0, eventId: existing.id }
    }

    const eventId = `ev-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`
    const activeEndpoints = this.endpoints.filter((e) => e.active)

    const newEvent: WebhookEvent = {
      id: eventId,
      tenant_id: MOCK_TENANT.id,
      idempotency_key: data.idempotency_key,
      event_type: data.event_type || (data.payload.type as string) || (data.payload.event as string) || 'custom.event',
      payload: data.payload,
      created_at: new Date().toISOString(),
      delivery_count: activeEndpoints.length,
      succeeded_count: 0,
      failed_count: 0,
    }

    this.events.unshift(newEvent)

    // 2. Atomic fan-out: enqueue delivery for each active endpoint
    activeEndpoints.forEach((ep) => {
      const seq = ep.next_seq || 1
      ep.next_seq = seq + 1

      const deliveryId = `del-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`
      const newDelivery: Delivery = {
        id: deliveryId,
        event_id: eventId,
        endpoint_id: ep.id,
        seq,
        state: 'PENDING',
        attempt_count: 0,
        next_attempt_at: new Date().toISOString(),
        lease_until: null,
        last_error: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        endpoint_url: ep.url,
        last_status_code: null,
      }

      this.deliveries.unshift(newDelivery)
      this.attempts[deliveryId] = []
    })

    return {
      duplicate: false,
      deliveriesEnqueued: activeEndpoints.length,
      eventId,
    }
  }

  // --- Deliveries ---
  getDeliveries(filter?: DeliveryQueryParams & { search?: string }): PaginatedList<Delivery> {
    let result = [...this.deliveries]

    if (filter?.state && filter.state !== 'ALL') {
      result = result.filter((d) => d.state === filter.state)
    }

    if (filter?.endpoint_id) {
      result = result.filter((d) => d.endpoint_id === filter.endpoint_id)
    }

    if (filter?.event_id) {
      result = result.filter((d) => d.event_id === filter.event_id)
    }

    if (filter?.created_after) {
      const after = new Date(filter.created_after).getTime()
      result = result.filter((d) => new Date(d.created_at).getTime() >= after)
    }

    if (filter?.created_before) {
      const before = new Date(filter.created_before).getTime()
      result = result.filter((d) => new Date(d.created_at).getTime() <= before)
    }

    const searchQuery = filter?.q || filter?.search
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      result = result.filter(
        (d) =>
          d.id.toLowerCase().includes(q) ||
          d.event_id.toLowerCase().includes(q) ||
          d.endpoint_url?.toLowerCase().includes(q) ||
          (d.last_error && d.last_error.toLowerCase().includes(q))
      )
    }

    const totalRecords = result.length
    const page = Math.max(1, filter?.page || 1)
    const pageSize = Math.min(100, Math.max(1, filter?.pageSize || filter?.limit || 20))
    const totalPages = totalRecords === 0 ? 0 : Math.ceil(totalRecords / pageSize)
    const offset = filter?.offset !== undefined && filter?.page === undefined ? Math.max(0, filter.offset) : (page - 1) * pageSize
    const sliced = result.slice(offset, offset + pageSize)

    const pagination: PaginationMeta = {
      page,
      pageSize,
      totalRecords,
      totalPages,
      hasNext: offset + pageSize < totalRecords,
      hasPrev: totalRecords > 0 && offset > 0,
      ...(filter?.offset !== undefined && filter?.page === undefined ? { offset } : {}),
    }

    return createPaginatedList(sliced, pagination)
  }

  getDelivery(id: string): Delivery | undefined {
    const delivery = this.deliveries.find((d) => d.id === id)
    if (!delivery) return undefined

    const endpoint = this.getEndpoint(delivery.endpoint_id)
    const event = this.getEvent(delivery.event_id)
    const attempts = this.attempts[id] || []

    return {
      ...delivery,
      endpoint,
      event,
      attempts,
    }
  }

  getDeadLetters(): Delivery[] {
    return this.getDeliveries({ state: 'DEAD' })
  }

  replayDelivery(id: string): { success: boolean; message: string; delivery?: Delivery } {
    const delivery = this.deliveries.find((d) => d.id === id)
    if (!delivery) {
      return { success: false, message: `Delivery ${id} not found.` }
    }

    if (delivery.state !== 'DEAD') {
      return {
        success: false,
        message: `Delivery ${id} is in state ${delivery.state}. Only DEAD deliveries can be replayed.`,
      }
    }

    // Replay logic:
    // Reset state to PENDING, update attempt timestamp
    delivery.state = 'PENDING'
    delivery.next_attempt_at = new Date().toISOString()
    delivery.updated_at = new Date().toISOString()
    delivery.last_error = null

    // Record new attempt record in attempt history
    const nextAttemptNo = (delivery.attempt_count || 0) + 1
    const newAttempt: DeliveryAttempt = {
      id: Date.now(),
      delivery_id: delivery.id,
      attempt_no: nextAttemptNo,
      started_at: new Date().toISOString(),
      status_code: 200,
      latency_ms: Math.floor(40 + Math.random() * 80),
      error: null,
    }

    if (!this.attempts[id]) {
      this.attempts[id] = []
    }
    this.attempts[id].push(newAttempt)

    // In a realistic simulation, after being picked up, it succeeds:
    setTimeout(() => {
      delivery.state = 'SUCCEEDED'
      delivery.attempt_count = nextAttemptNo
      delivery.last_status_code = 200
      delivery.updated_at = new Date().toISOString()
    }, 1500)

    return {
      success: true,
      message: `Delivery ${id} re-enqueued for replay.`,
      delivery,
    }
  }

  // --- Metrics ---
  getOverviewMetrics(filter?: MetricsQueryParams): OverviewMetrics {
    let dels = [...this.deliveries]
    let evts = [...this.events]

    if (filter?.created_after) {
      const after = new Date(filter.created_after).getTime()
      dels = dels.filter((d) => new Date(d.created_at).getTime() >= after)
      evts = evts.filter((e) => new Date(e.created_at).getTime() >= after)
    }

    if (filter?.created_before) {
      const before = new Date(filter.created_before).getTime()
      dels = dels.filter((d) => new Date(d.created_at).getTime() <= before)
      evts = evts.filter((e) => new Date(e.created_at).getTime() <= before)
    }

    const totalDeliveries = dels.length
    const succeeded = dels.filter((d) => d.state === 'SUCCEEDED').length
    const failed = dels.filter((d) => d.state === 'DEAD').length
    const pending = dels.filter(
      (d) => d.state === 'PENDING' || d.state === 'IN_FLIGHT' || d.state === 'RETRYING'
    ).length

    const successRate = totalDeliveries > 0 ? (succeeded / totalDeliveries) * 100 : 100
    const activeEndpoints = this.endpoints.filter((e) => e.active).length
    const openCircuits = this.endpoints.filter((e) => e.circuit_state === 'OPEN').length

    return {
      totalEvents: evts.length,
      totalDeliveries,
      succeededDeliveries: succeeded,
      failedDeliveries: failed,
      pendingDeliveries: pending,
      successRate: Math.round(successRate * 10) / 10,
      averageLatencyMs: totalDeliveries > 0 ? 68 : 0,
      activeEndpoints,
      totalEndpoints: this.endpoints.length,
      openCircuits,
    }
  }

  getTimeSeriesMetrics(filter?: MetricsQueryParams): TimeSeriesDataPoint[] {
    if (filter?.range === '7d') {
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      const now = new Date()
      return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(now.getTime() - (6 - i) * 86400000)
        const dayLabel = `${monthNames[d.getUTCMonth()]} ${d.getUTCDate()}`
        const y = d.getUTCFullYear()
        const m = String(d.getUTCMonth() + 1).padStart(2, '0')
        const day = String(d.getUTCDate()).padStart(2, '0')
        const total = 500 + (i * 120) % 700
        const succeeded = Math.round(total * 0.96)
        const failed = total - succeeded
        return {
          timestamp: `${y}-${m}-${day}`,
          label: dayLabel,
          total,
          succeeded,
          failed,
          pending: 0,
        }
      })
    }

    if (filter?.range === '30d') {
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      const now = new Date()
      return Array.from({ length: 30 }, (_, i) => {
        const d = new Date(now.getTime() - (29 - i) * 86400000)
        const dayLabel = `${monthNames[d.getUTCMonth()]} ${d.getUTCDate()}`
        const y = d.getUTCFullYear()
        const m = String(d.getUTCMonth() + 1).padStart(2, '0')
        const day = String(d.getUTCDate()).padStart(2, '0')
        const total = 400 + (i * 90) % 800
        const succeeded = Math.round(total * 0.97)
        const failed = total - succeeded
        return {
          timestamp: `${y}-${m}-${day}`,
          label: dayLabel,
          total,
          succeeded,
          failed,
          pending: 0,
        }
      })
    }

    return [...MOCK_TIME_SERIES]
  }

  getStatusDistribution(filter?: MetricsQueryParams): StatusDistribution[] {
    let dels = [...this.deliveries]
    if (filter?.created_after) {
      const after = new Date(filter.created_after).getTime()
      dels = dels.filter((d) => new Date(d.created_at).getTime() >= after)
    }
    if (filter?.created_before) {
      const before = new Date(filter.created_before).getTime()
      dels = dels.filter((d) => new Date(d.created_at).getTime() <= before)
    }

    const counts = {
      SUCCEEDED: dels.filter((d) => d.state === 'SUCCEEDED').length,
      RETRYING: dels.filter((d) => d.state === 'RETRYING').length,
      DEAD: dels.filter((d) => d.state === 'DEAD').length,
      IN_FLIGHT: dels.filter((d) => d.state === 'IN_FLIGHT').length,
      PENDING: dels.filter((d) => d.state === 'PENDING').length,
    }

    return [
      { name: 'Succeeded', value: counts.SUCCEEDED, color: '#10b981' },
      { name: 'Retrying', value: counts.RETRYING, color: '#f59e0b' },
      { name: 'Dead Letter', value: counts.DEAD, color: '#ef4444' },
      { name: 'In Flight', value: counts.IN_FLIGHT, color: '#6366f1' },
      { name: 'Pending', value: counts.PENDING, color: '#3b82f6' },
    ]
  }
}

export const mockStore = new MockStore()
