import type {
  Endpoint,
  WebhookEvent,
  Delivery,
  DeliveryAttempt,
  OverviewMetrics,
  TimeSeriesDataPoint,
  StatusDistribution,
} from '../types'
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
  getEvents(): WebhookEvent[] {
    return [...this.events]
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
  getDeliveries(filter?: {
    state?: string
    endpoint_id?: string
    event_id?: string
    search?: string
  }): Delivery[] {
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

    if (filter?.search) {
      const q = filter.search.toLowerCase()
      result = result.filter(
        (d) =>
          d.id.toLowerCase().includes(q) ||
          d.event_id.toLowerCase().includes(q) ||
          d.endpoint_url?.toLowerCase().includes(q) ||
          (d.last_error && d.last_error.toLowerCase().includes(q))
      )
    }

    return result
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
  getOverviewMetrics(): OverviewMetrics {
    const totalDeliveries = this.deliveries.length
    const succeeded = this.deliveries.filter((d) => d.state === 'SUCCEEDED').length
    const failed = this.deliveries.filter((d) => d.state === 'DEAD').length
    const pending = this.deliveries.filter(
      (d) => d.state === 'PENDING' || d.state === 'IN_FLIGHT' || d.state === 'RETRYING'
    ).length

    const successRate = totalDeliveries > 0 ? (succeeded / totalDeliveries) * 100 : 100
    const activeEndpoints = this.endpoints.filter((e) => e.active).length
    const openCircuits = this.endpoints.filter((e) => e.circuit_state === 'OPEN').length

    return {
      totalEvents: this.events.length,
      totalDeliveries,
      succeededDeliveries: succeeded,
      failedDeliveries: failed,
      pendingDeliveries: pending,
      successRate: Math.round(successRate * 10) / 10,
      averageLatencyMs: 68,
      activeEndpoints,
      totalEndpoints: this.endpoints.length,
      openCircuits,
    }
  }

  getTimeSeriesMetrics(): TimeSeriesDataPoint[] {
    return [...MOCK_TIME_SERIES]
  }

  getStatusDistribution(): StatusDistribution[] {
    const counts = {
      SUCCEEDED: this.deliveries.filter((d) => d.state === 'SUCCEEDED').length,
      RETRYING: this.deliveries.filter((d) => d.state === 'RETRYING').length,
      DEAD: this.deliveries.filter((d) => d.state === 'DEAD').length,
      IN_FLIGHT: this.deliveries.filter((d) => d.state === 'IN_FLIGHT').length,
      PENDING: this.deliveries.filter((d) => d.state === 'PENDING').length,
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
