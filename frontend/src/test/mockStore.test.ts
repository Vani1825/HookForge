import { describe, it, expect } from 'vitest'
import { mockStore } from '../mocks/mockStore'

describe('MockStore Lifecycle & Guarantees', () => {
  it('initializes with default fixtures', () => {
    const endpoints = mockStore.getEndpoints()
    const events = mockStore.getEvents()
    const deliveries = mockStore.getDeliveries()

    expect(endpoints.length).toBeGreaterThan(0)
    expect(events.length).toBeGreaterThan(0)
    expect(deliveries.length).toBeGreaterThan(0)
  })

  it('creates an endpoint and generates an HMAC secret', () => {
    const endpoint = mockStore.createEndpoint({
      url: 'https://test-receiver.internal.net/hook',
      rate_limit_rps: 15,
      description: 'Test Receiver',
    })

    expect(endpoint.url).toBe('https://test-receiver.internal.net/hook')
    expect(endpoint.rate_limit_rps).toBe(15)
    expect(endpoint.secret).toMatch(/^whsec_[0-9a-f]{32}$/)
    expect(endpoint.active).toBe(true)
    expect(endpoint.circuit_state).toBe('CLOSED')
  })

  it('enforces idempotency key uniqueness upon event ingest', () => {
    const key = `ik_test_${Date.now()}`
    const firstResult = mockStore.ingestEvent({
      idempotency_key: key,
      event_type: 'test.event',
      payload: { hello: 'world' },
    })

    expect(firstResult.duplicate).toBe(false)
    expect(firstResult.deliveriesEnqueued).toBeGreaterThan(0)

    // Second ingest with identical idempotency key
    const duplicateResult = mockStore.ingestEvent({
      idempotency_key: key,
      event_type: 'test.event',
      payload: { hello: 'world' },
    })

    expect(duplicateResult.duplicate).toBe(true)
    expect(duplicateResult.deliveriesEnqueued).toBe(0)
  })

  it('allows replaying a DEAD delivery', () => {
    const deadLetters = mockStore.getDeadLetters()
    expect(deadLetters.length).toBeGreaterThan(0)

    const target = deadLetters[0]
    const replayResult = mockStore.replayDelivery(target.id)

    expect(replayResult.success).toBe(true)
    expect(replayResult.delivery?.state).toBe('PENDING')
  })

  it('rejects replaying a non-DEAD delivery', () => {
    const succeeded = mockStore.getDeliveries({ state: 'SUCCEEDED' })
    if (succeeded.length > 0) {
      const res = mockStore.replayDelivery(succeeded[0].id)
      expect(res.success).toBe(false)
    }
  })

  describe('resendDelivery (Tanvi Phase 2)', () => {
    it('allows resending DEAD, SUCCEEDED, and CANCELLED deliveries in queued mode', () => {
      const deadDeliveries = mockStore.getDeliveries({ state: 'DEAD' })
      expect(deadDeliveries.length).toBeGreaterThan(0)
      const resDead = mockStore.resendDelivery(deadDeliveries[0].id, { immediate: false })
      expect(resDead.success).toBe(true)
      expect(resDead.delivery?.state).toBe('PENDING')
      expect(resDead.delivery?.attempt_count).toBe(0)

      const succeededDeliveries = mockStore.getDeliveries({ state: 'SUCCEEDED' })
      expect(succeededDeliveries.length).toBeGreaterThan(0)
      const resSucceeded = mockStore.resendDelivery(succeededDeliveries[0].id, { immediate: false })
      expect(resSucceeded.success).toBe(true)
      expect(resSucceeded.delivery?.state).toBe('PENDING')
      expect(resSucceeded.delivery?.attempt_count).toBe(0)

      // Find or create a cancelled delivery in mockStore
      let cancelledDelivery = mockStore.getDeliveries().find((d) => d.state === 'CANCELLED')
      if (!cancelledDelivery) {
        const d = mockStore.getDeliveries()[0]
        d.state = 'CANCELLED'
        cancelledDelivery = d
      }
      const resCancelled = mockStore.resendDelivery(cancelledDelivery.id, { immediate: false })
      expect(resCancelled.success).toBe(true)
      expect(resCancelled.delivery?.state).toBe('PENDING')
    })

    it('allows immediate execution mode for resendDelivery', () => {
      const target = mockStore.getDeliveries()[0]
      target.state = 'DEAD'

      const res = mockStore.resendDelivery(target.id, { immediate: true })
      expect(res.success).toBe(true)
      expect(res.message).toBe('Delivery resent immediately')
      expect(res.delivery?.state).toBe('SUCCEEDED')
      expect(res.attempt).toBeDefined()
      expect(res.attempt?.statusCode).toBe(200)
      expect(res.attempt?.request_headers).toBeDefined()
      expect(res.attempt?.request_headers?.['content-type']).toBe('application/json')
      expect(res.attempt?.request_headers?.['x-webhook-signature']).toBe('[REDACTED]')
      expect(res.attempt?.response_headers?.['content-type']).toContain('application/json')
      expect(res.attempt?.response_body).toBeDefined()
    })

    it('rejects resending an IN_FLIGHT delivery', () => {
      const target = mockStore.getDeliveries()[0]
      target.state = 'IN_FLIGHT'

      const res = mockStore.resendDelivery(target.id)
      expect(res.success).toBe(false)
      expect(res.message).toContain('in flight')
    })

    it('rejects resending an unsupported state such as SCHEDULED', () => {
      const target = mockStore.getDeliveries()[0]
      target.state = 'SCHEDULED'

      const res = mockStore.resendDelivery(target.id)
      expect(res.success).toBe(false)
      expect(res.message).toContain('Resend is only supported for DEAD, SUCCEEDED, and CANCELLED')
    })
  })
})
