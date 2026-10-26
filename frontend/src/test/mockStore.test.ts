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
})
