import type {
  Endpoint,
  WebhookEvent,
  Delivery,
  DeliveryAttempt,
  OverviewMetrics,
  TimeSeriesDataPoint,
  StatusDistribution,
  PaginationMeta,
  ScheduleDeliveryInput,
  BulkReplayResult,
  EndpointTestInput,
  EndpointTestResult,
  RetryStrategy,
  WebhookTemplate,
  CreateTemplateInput,
  UpdateTemplateInput,
  TemplateApplyResult,
  DeliveryAttemptsResponse,
  DeliveryLogsResponse,
  DeliveryLogEntry,
  DeliveryDiagnostics,
} from '../types'
import { createPaginatedList, type PaginatedList, type DeliveryQueryParams } from '../api/deliveries'
import type { EventQueryParams } from '../api/events'
import type { MetricsQueryParams } from '../api/metrics'
import type { CreateEndpointInput, UpdateEndpointInput } from '../api/endpoints'
import {
  MOCK_TENANT,
  INITIAL_MOCK_ENDPOINTS,
  INITIAL_MOCK_EVENTS,
  INITIAL_MOCK_DELIVERIES,
  INITIAL_MOCK_ATTEMPTS,
  MOCK_TIME_SERIES,
  INITIAL_MOCK_TEMPLATES,
} from './mockData'

class MockStore {
  private endpoints: Endpoint[] = [...INITIAL_MOCK_ENDPOINTS]
  private events: WebhookEvent[] = [...INITIAL_MOCK_EVENTS]
  private deliveries: Delivery[] = [...INITIAL_MOCK_DELIVERIES]
  private attempts: Record<string, DeliveryAttempt[]> = { ...INITIAL_MOCK_ATTEMPTS }
  private templates: WebhookTemplate[] = [...INITIAL_MOCK_TEMPLATES]

  // --- Endpoints ---
  getEndpoints(): Endpoint[] {
    return [...this.endpoints]
  }

  getEndpoint(id: string): Endpoint | undefined {
    return this.endpoints.find((e) => e.id === id)
  }

  createEndpoint(data: CreateEndpointInput): Endpoint {
    const randomHex = Array.from({ length: 32 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join('')

    const templateId = data.templateId || data.template_id
    const template = templateId ? this.getTemplate(templateId) : undefined
    const effectiveUrl = data.url || template?.url || ''
    const effectiveRps = data.rate_limit_rps || data.rateLimitRps || template?.rate_limit_rps || 10

    const strategy = (
      data.retryStrategy ||
      data.retry_strategy ||
      data.retryPolicy?.strategy ||
      template?.retry_strategy ||
      'EXPONENTIAL'
    ) as RetryStrategy

    const maxAttempts =
      data.retryMaxAttempts ??
      data.retry_max_attempts ??
      data.retryPolicy?.maxAttempts ??
      template?.retry_max_attempts ??
      8

    const baseDelayMs =
      data.retryBaseDelayMs ??
      data.retry_base_delay_ms ??
      data.retryPolicy?.baseDelayMs ??
      template?.retry_base_delay_ms ??
      5000

    const maxDelayMs =
      data.retryMaxDelayMs ??
      data.retry_max_delay_ms ??
      data.retryPolicy?.maxDelayMs ??
      template?.retry_max_delay_ms ??
      (strategy === 'FIXED' ? baseDelayMs : 3600000)

    const backoffMultiplier =
      data.retryBackoffMultiplier ??
      data.retry_backoff_multiplier ??
      data.retryPolicy?.backoffMultiplier ??
      template?.retry_backoff_multiplier ??
      (strategy === 'FIXED' ? 1.0 : 2.0)

    const newEndpoint: Endpoint = {
      id: `e1000000-0000-0000-0000-${Math.floor(100000000000 + Math.random() * 900000000000)}`,
      tenant_id: MOCK_TENANT.id,
      url: effectiveUrl,
      secret: `whsec_${randomHex}`,
      active: true,
      rate_limit_rps: effectiveRps,
      next_seq: 1,
      circuit_state: 'CLOSED',
      circuit_until: null,
      consecutive_failures: 0,
      created_at: new Date().toISOString(),
      description: data.description || (template ? `Created from ${template.name}` : 'Webhook destination'),
      total_deliveries: 0,
      success_rate: 100,
      retry_strategy: strategy,
      retryStrategy: strategy,
      retry_max_attempts: maxAttempts,
      retryMaxAttempts: maxAttempts,
      retry_base_delay_ms: baseDelayMs,
      retryBaseDelayMs: baseDelayMs,
      retry_max_delay_ms: maxDelayMs,
      retryMaxDelayMs: maxDelayMs,
      retry_backoff_multiplier: backoffMultiplier,
      retryBackoffMultiplier: backoffMultiplier,
      retryPolicy: {
        strategy,
        maxAttempts,
        baseDelayMs,
        maxDelayMs,
        backoffMultiplier,
      },
    }

    this.endpoints.unshift(newEndpoint)
    return newEndpoint
  }

  updateEndpoint(id: string, updates: UpdateEndpointInput | Partial<Endpoint>): Endpoint | null {
    const idx = this.endpoints.findIndex((e) => e.id === id)
    if (idx === -1) return null

    const existing = this.endpoints[idx]
    const strategy = (updates.retryStrategy || updates.retry_strategy || updates.retryPolicy?.strategy || existing.retryStrategy || existing.retry_strategy || 'EXPONENTIAL') as RetryStrategy
    const maxAttempts = updates.retryMaxAttempts ?? updates.retry_max_attempts ?? updates.retryPolicy?.maxAttempts ?? existing.retryMaxAttempts ?? existing.retry_max_attempts ?? 8
    const baseDelayMs = updates.retryBaseDelayMs ?? updates.retry_base_delay_ms ?? updates.retryPolicy?.baseDelayMs ?? existing.retryBaseDelayMs ?? existing.retry_base_delay_ms ?? 5000
    const maxDelayMs = updates.retryMaxDelayMs ?? updates.retry_max_delay_ms ?? updates.retryPolicy?.maxDelayMs ?? existing.retryMaxDelayMs ?? existing.retry_max_delay_ms ?? (strategy === 'FIXED' ? baseDelayMs : 3600000)
    const backoffMultiplier = updates.retryBackoffMultiplier ?? updates.retry_backoff_multiplier ?? updates.retryPolicy?.backoffMultiplier ?? existing.retryBackoffMultiplier ?? existing.retry_backoff_multiplier ?? (strategy === 'FIXED' ? 1.0 : 2.0)

    const updatedEndpoint: Endpoint = {
      ...existing,
      ...updates,
      retry_strategy: strategy,
      retryStrategy: strategy,
      retry_max_attempts: maxAttempts,
      retryMaxAttempts: maxAttempts,
      retry_base_delay_ms: baseDelayMs,
      retryBaseDelayMs: baseDelayMs,
      retry_max_delay_ms: maxDelayMs,
      retryMaxDelayMs: maxDelayMs,
      retry_backoff_multiplier: backoffMultiplier,
      retryBackoffMultiplier: backoffMultiplier,
      retryPolicy: {
        strategy,
        maxAttempts,
        baseDelayMs,
        maxDelayMs,
        backoffMultiplier,
      },
    }

    this.endpoints[idx] = updatedEndpoint
    return updatedEndpoint
  }

  toggleEndpoint(id: string): Endpoint | null {
    const endpoint = this.getEndpoint(id)
    if (!endpoint) return null
    return this.updateEndpoint(id, { active: !endpoint.active })
  }

  deleteEndpoint(id: string): boolean {
    const idx = this.endpoints.findIndex((e) => e.id === id)
    if (idx === -1) return false
    this.endpoints.splice(idx, 1)
    return true
  }

  testEndpoint(input: EndpointTestInput): EndpointTestResult {
    const endpointId = input.endpointId || input.endpoint_id
    const endpoint = endpointId ? this.getEndpoint(endpointId) : undefined
    const url = input.url || endpoint?.url || 'https://webhook.example.com/test'
    const method = (input.method || 'POST').toUpperCase()
    const isGetOrHead = method === 'GET' || method === 'HEAD'

    const isErrorSimulation =
      url.toLowerCase().includes('fail') || url.toLowerCase().includes('error')
    const isTimeoutSimulation = url.toLowerCase().includes('timeout')
    const isNotFoundSimulation =
      url.toLowerCase().includes('404') || url.toLowerCase().includes('notfound')

    const latencyMs = Math.floor(25 + Math.random() * 45) // Realistic 25-70ms
    const timestamp = Math.floor(Date.now() / 1000)

    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Webhook-Id': `test_${Array.from({ length: 8 }, () =>
        Math.floor(Math.random() * 16).toString(16)
      ).join('')}`,
      'X-Webhook-Timestamp': timestamp.toString(),
      'X-HookForge-Test': 'true',
      ...(input.headers || {}),
    }

    if (endpoint?.secret || input.secret) {
      requestHeaders['X-Webhook-Signature'] = `t=${timestamp},v1=mock_signature_${Array.from(
        { length: 16 },
        () => Math.floor(Math.random() * 16).toString(16)
      ).join('')}`
    }

    const sanitizedHeaders: Record<string, string> = {}
    for (const [k, v] of Object.entries(requestHeaders)) {
      if (
        ['authorization', 'x-api-key', 'api-key', 'proxy-authorization'].includes(
          k.toLowerCase()
        )
      ) {
        sanitizedHeaders[k] = '[REDACTED]'
      } else {
        sanitizedHeaders[k] = v
      }
    }

    const payload = isGetOrHead
      ? null
      : input.payload !== undefined
        ? input.payload
        : input.body !== undefined
          ? input.body
          : {
              event: 'endpoint.test',
              timestamp: new Date().toISOString(),
              message: 'HookForge webhook endpoint test payload',
              data: { test: true, endpointId: endpoint?.id || null },
            }

    if (isTimeoutSimulation) {
      return {
        success: false,
        statusCode: null,
        status_code: null,
        latencyMs: input.timeoutMs || 5000,
        latency_ms: input.timeoutMs || 5000,
        error: 'Timeout',
        request: { url, method, headers: sanitizedHeaders, payload },
        response: null,
        testedAt: new Date().toISOString(),
        tested_at: new Date().toISOString(),
      }
    }

    if (isNotFoundSimulation) {
      const respBody = JSON.stringify({
        error: 'Endpoint destination not found',
        path: url,
      })
      return {
        success: false,
        statusCode: 404,
        status_code: 404,
        latencyMs,
        latency_ms: latencyMs,
        error: null,
        request: { url, method, headers: sanitizedHeaders, payload },
        response: {
          statusCode: 404,
          status_code: 404,
          headers: { 'content-type': 'application/json', 'server': 'MockServer/1.0' },
          body: respBody,
          sizeBytes: respBody.length,
          size_bytes: respBody.length,
          truncated: false,
        },
        testedAt: new Date().toISOString(),
        tested_at: new Date().toISOString(),
      }
    }

    if (isErrorSimulation) {
      const respBody = JSON.stringify({
        error: 'Internal Server Error',
        message: 'Simulated endpoint server fault',
      })
      return {
        success: false,
        statusCode: 500,
        status_code: 500,
        latencyMs,
        latency_ms: latencyMs,
        error: null,
        request: { url, method, headers: sanitizedHeaders, payload },
        response: {
          statusCode: 500,
          status_code: 500,
          headers: { 'content-type': 'application/json', 'server': 'MockServer/1.0' },
          body: respBody,
          sizeBytes: respBody.length,
          size_bytes: respBody.length,
          truncated: false,
        },
        testedAt: new Date().toISOString(),
        tested_at: new Date().toISOString(),
      }
    }

    const respBody = JSON.stringify({
      status: 'received',
      ok: true,
      message: 'Webhook probe successfully received and acknowledged',
      endpointId: endpoint?.id || null,
      receivedAt: new Date().toISOString(),
    })

    return {
      success: true,
      statusCode: 200,
      status_code: 200,
      latencyMs,
      latency_ms: latencyMs,
      error: null,
      request: { url, method, headers: sanitizedHeaders, payload },
      response: {
        statusCode: 200,
        status_code: 200,
        headers: {
          'content-type': 'application/json',
          'server': 'HookForge-MockReceiver/1.0',
          'x-request-id': `req_${Date.now()}`,
        },
        body: respBody,
        sizeBytes: respBody.length,
        size_bytes: respBody.length,
        truncated: false,
      },
      testedAt: new Date().toISOString(),
      tested_at: new Date().toISOString(),
    }
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

  // Helper for redacting sensitive payload fields in demo mode
  private redactPayload(data: unknown): unknown {
    if (!data || typeof data !== 'object') return data
    if (Array.isArray(data)) return data.map((item) => this.redactPayload(item))
    const res: Record<string, unknown> = {}
    const sensitive = /^(password|secret|token|api_?key|auth|credential|card|cvv|ssn)$/i
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (sensitive.test(k)) {
        res[k] = '[REDACTED]'
      } else if (v && typeof v === 'object') {
        res[k] = this.redactPayload(v)
      } else {
        res[k] = v
      }
    }
    return res
  }

  // --- Deliveries ---
  getDeliveries(filter?: DeliveryQueryParams & { search?: string }): PaginatedList<Delivery> {
    let result = [...this.deliveries]

    // 1. State filter (single or comma-separated multi-state)
    if (filter?.state && filter.state !== 'ALL') {
      const states = filter.state
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
      if (states.length > 0) {
        result = result.filter((d) => states.includes(d.state.toUpperCase()))
      }
    }

    // 2. Endpoint ID filter (single or comma-separated)
    const epId = filter?.endpoint_id || filter?.endpointId
    if (epId) {
      const ids = epId.split(',').map((s) => s.trim()).filter(Boolean)
      if (ids.length > 0) {
        result = result.filter((d) => ids.includes(d.endpoint_id))
      }
    }

    // 3. Event ID filter (single or comma-separated)
    const evId = filter?.event_id || filter?.eventId
    if (evId) {
      const ids = evId.split(',').map((s) => s.trim()).filter(Boolean)
      if (ids.length > 0) {
        result = result.filter((d) => ids.includes(d.event_id))
      }
    }

    // 4. Event Type filter
    const evType = filter?.event_type || filter?.eventType
    if (evType) {
      const targetType = evType.trim().toLowerCase()
      result = result.filter((d) => {
        const ev = this.getEvent(d.event_id)
        const typeStr = ev?.event_type || (ev?.payload as any)?.type || (ev?.payload as any)?.event || ''
        return String(typeStr).toLowerCase() === targetType
      })
    }

    // 5. Date range bounds
    const afterParam = filter?.created_after || filter?.from || filter?.startDate
    if (afterParam) {
      const after = new Date(afterParam).getTime()
      if (!isNaN(after)) {
        result = result.filter((d) => new Date(d.created_at).getTime() >= after)
      }
    }

    const beforeParam = filter?.created_before || filter?.to || filter?.endDate
    if (beforeParam) {
      const before = new Date(beforeParam).getTime()
      if (!isNaN(before)) {
        result = result.filter((d) => new Date(d.created_at).getTime() <= before)
      }
    }

    // 6. HTTP Status Code or Class (e.g., 2xx, 3xx, 4xx, 5xx or exact integer 504)
    const sc = filter?.status_code !== undefined ? filter.status_code : filter?.statusCode
    if (sc !== undefined && sc !== null && sc !== '') {
      const scStr = String(sc).trim().toLowerCase()
      if (['2xx', '3xx', '4xx', '5xx'].includes(scStr)) {
        const classPrefix = scStr[0]
        result = result.filter((d) => {
          const code = d.last_status_code !== undefined ? d.last_status_code : d.lastStatusCode
          if (code !== null && code !== undefined && String(code).startsWith(classPrefix)) {
            return true
          }
          const atts = this.attempts[d.id] || []
          return atts.some(
            (a) =>
              (a.status_code !== null && a.status_code !== undefined && String(a.status_code).startsWith(classPrefix)) ||
              (a.statusCode !== null && a.statusCode !== undefined && String(a.statusCode).startsWith(classPrefix))
          )
        })
      } else {
        const num = parseInt(scStr, 10)
        if (!isNaN(num)) {
          result = result.filter((d) => {
            const code = d.last_status_code !== undefined ? d.last_status_code : d.lastStatusCode
            if (code === num) return true
            const atts = this.attempts[d.id] || []
            return atts.some((a) => a.status_code === num || a.statusCode === num)
          })
        }
      }
    }

    // 7. Attempt counts and range bounds
    const exactAttempts: any = filter?.attempt_count !== undefined ? filter.attempt_count : filter?.attempts
    if (exactAttempts !== undefined && exactAttempts !== null && String(exactAttempts).trim() !== '') {
      const num = Number(exactAttempts)
      if (!isNaN(num)) {
        result = result.filter((d) => (d.attempt_count ?? d.attemptCount ?? 0) === num)
      }
    }

    const minAtt: any = filter?.min_attempts !== undefined ? filter.min_attempts : filter?.minAttempts
    if (minAtt !== undefined && minAtt !== null && String(minAtt).trim() !== '') {
      const num = Number(minAtt)
      if (!isNaN(num)) {
        result = result.filter((d) => (d.attempt_count ?? d.attemptCount ?? 0) >= num)
      }
    }

    const maxAtt: any = filter?.max_attempts !== undefined ? filter.max_attempts : filter?.maxAttempts
    if (maxAtt !== undefined && maxAtt !== null && String(maxAtt).trim() !== '') {
      const num = Number(maxAtt)
      if (!isNaN(num)) {
        result = result.filter((d) => (d.attempt_count ?? d.attemptCount ?? 0) <= num)
      }
    }

    // 8. Text search across fields
    const searchQuery = filter?.q || filter?.search
    if (searchQuery) {
      const q = searchQuery.toLowerCase().trim()
      result = result.filter((d) => {
        const ev = this.getEvent(d.event_id)
        const ep = this.getEndpoint(d.endpoint_id)
        return (
          d.id.toLowerCase().includes(q) ||
          d.event_id.toLowerCase().includes(q) ||
          d.endpoint_id.toLowerCase().includes(q) ||
          (d.endpoint_url && d.endpoint_url.toLowerCase().includes(q)) ||
          (ep?.url && ep.url.toLowerCase().includes(q)) ||
          (d.last_error && d.last_error.toLowerCase().includes(q)) ||
          (ev?.idempotency_key && ev.idempotency_key.toLowerCase().includes(q)) ||
          (ev?.event_type && ev.event_type.toLowerCase().includes(q)) ||
          (ev?.payload && JSON.stringify(ev.payload).toLowerCase().includes(q))
        )
      })
    }

    // 9. Sorting
    if (filter?.sortBy) {
      const col = filter.sortBy
      const order = (filter.sortOrder || 'DESC').toUpperCase()
      const mult = order === 'ASC' ? 1 : -1
      result.sort((a: any, b: any) => {
        const valA = a[col] ?? ''
        const valB = b[col] ?? ''
        if (typeof valA === 'number' && typeof valB === 'number') {
          return (valA - valB) * mult
        }
        return String(valA).localeCompare(String(valB)) * mult
      })
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
      ...(filter?.sortBy ? { sortBy: filter.sortBy } : {}),
      ...(filter?.sortOrder ? { sortOrder: filter.sortOrder } : {}),
    }

    return createPaginatedList(sliced, pagination)
  }

  getDelivery(id: string): Delivery | undefined {
    const delivery = this.deliveries.find((d) => d.id === id)
    if (!delivery) return undefined

    const rawEndpoint = this.getEndpoint(delivery.endpoint_id)
    const rawEvent = this.getEvent(delivery.event_id)
    const attempts = this.attempts[id] || []

    // Endpoint stripped of secrets
    const endpoint = rawEndpoint
      ? {
          ...rawEndpoint,
          secret: undefined,
        }
      : undefined

    // Event with redacted payload
    const event = rawEvent
      ? {
          ...rawEvent,
          payload: this.redactPayload(rawEvent.payload) as Record<string, unknown>,
        }
      : undefined

    // Diagnostics calculation
    let diagnostics: DeliveryDiagnostics | undefined = undefined
    if (delivery.state === 'DEAD') {
      const lastErr = (delivery.last_error || '').toLowerCase()
      const lastCode = delivery.last_status_code ?? delivery.lastStatusCode
      if (lastErr.includes('timeout') || lastCode === 504) {
        diagnostics = {
          category: 'TIMEOUT',
          recommendation:
            'The target server took too long to acknowledge the webhook. Verify server load, network latency, or increase the read timeout.',
        }
      } else if (lastCode === 429) {
        diagnostics = {
          category: 'RATE_LIMITED_429',
          recommendation:
            'Target endpoint is rate-limiting webhook dispatches. Reduce concurrency or adjust the endpoint rate limit.',
        }
      } else if (lastCode && lastCode >= 500) {
        diagnostics = {
          category: 'SERVER_ERROR_5XX',
          recommendation: `Target server returned HTTP ${lastCode} Internal Error. Check receiver application health and error logs.`,
        }
      } else if (lastCode && lastCode >= 400) {
        diagnostics = {
          category: 'CLIENT_ERROR_4XX',
          recommendation: `Target server returned HTTP ${lastCode} Client Error. Verify the webhook payload schema, authentication, and endpoint URL path.`,
        }
      } else {
        diagnostics = {
          category: 'NETWORK_ERROR',
          recommendation:
            'Failed to establish network connection with target server. Verify DNS records, firewall configurations, and endpoint host availability.',
        }
      }
    } else if (delivery.state === 'SUCCEEDED') {
      diagnostics = {
        category: 'SUCCESS',
        recommendation: 'Webhook delivered and acknowledged successfully.',
      }
    }

    // Retry policy
    const retryPolicy = rawEndpoint?.retryPolicy || {
      strategy: (rawEndpoint?.retry_strategy || rawEndpoint?.retryStrategy || 'EXPONENTIAL') as any,
      maxAttempts: rawEndpoint?.retry_max_attempts || rawEndpoint?.retryMaxAttempts || 8,
      baseDelayMs: rawEndpoint?.retry_base_delay_ms || rawEndpoint?.retryBaseDelayMs || 5000,
      maxDelayMs: rawEndpoint?.retry_max_delay_ms || rawEndpoint?.retryMaxDelayMs || 3600000,
      backoffMultiplier: rawEndpoint?.retry_backoff_multiplier || rawEndpoint?.retryBackoffMultiplier || 2.0,
    }

    // Lifecycle
    const lifecycle = {
      scheduledAt: delivery.scheduled_at || delivery.scheduledAt || null,
      leaseUntil: delivery.lease_until || null,
      createdAt: delivery.created_at || delivery.createdAt,
      updatedAt: delivery.updated_at || delivery.updatedAt,
      nextAttemptAt: delivery.next_attempt_at || delivery.nextAttemptAt || null,
    }

    // Request metadata
    const request = {
      url: delivery.endpoint_url || rawEndpoint?.url || 'https://api.example.com/webhook',
      method: 'POST',
      timestamp: delivery.created_at,
    }

    return {
      ...delivery,
      endpoint,
      event,
      attempts,
      diagnostics,
      retry: retryPolicy,
      lifecycle,
      request,
    }
  }

  getDeliveryAttempts(id: string): DeliveryAttemptsResponse {
    const attempts = this.attempts[id] || []
    return {
      deliveryId: id,
      totalAttempts: attempts.length,
      attempts: [...attempts],
    }
  }

  getDeliveryLogs(id: string): DeliveryLogsResponse {
    const delivery = this.getDelivery(id)
    if (!delivery) {
      return {
        deliveryId: id,
        state: 'UNKNOWN',
        attemptCount: 0,
        logs: [],
      }
    }

    const logs: DeliveryLogEntry[] = []

    // 1. Initial creation log
    logs.push({
      timestamp: delivery.created_at,
      level: 'INFO',
      event: 'DELIVERY_CREATED',
      message: `Delivery created and queued in state ${delivery.state === 'SCHEDULED' ? 'SCHEDULED' : 'PENDING'}`,
    })

    // 2. Scheduled log if scheduled
    if (delivery.scheduled_at) {
      logs.push({
        timestamp: delivery.created_at,
        level: 'INFO',
        event: 'DELIVERY_SCHEDULED',
        message: `Delivery execution scheduled for ${delivery.scheduled_at}`,
      })
    }

    // 3. Attempt logs
    const attempts = this.attempts[id] || []
    attempts.forEach((att) => {
      const code = att.status_code ?? att.statusCode
      const num = att.attempt_no ?? att.attemptNumber ?? 1
      const lat = att.latency_ms ?? att.latencyMs ?? 0
      const err = att.error ?? att.errorMessage

      if (code && code >= 200 && code <= 299) {
        logs.push({
          timestamp: att.started_at,
          level: 'INFO',
          event: 'DISPATCH_ATTEMPT_SUCCEEDED',
          attemptNumber: num,
          attempt_no: num,
          statusCode: code,
          status_code: code,
          latencyMs: lat,
          latency_ms: lat,
          message: `Attempt ${num} succeeded with HTTP ${code} (${lat}ms)`,
        })
      } else {
        logs.push({
          timestamp: att.started_at,
          level: 'ERROR',
          event: 'DISPATCH_ATTEMPT_FAILED',
          attemptNumber: num,
          attempt_no: num,
          statusCode: code || null,
          status_code: code || null,
          latencyMs: lat,
          latency_ms: lat,
          message: `Attempt ${num} failed with status ${code || 'TIMEOUT'} (${lat}ms): ${err || 'Delivery attempt failed'}`,
        })
      }
    })

    // 4. Terminal state log
    if (delivery.state === 'DEAD') {
      logs.push({
        timestamp: delivery.updated_at,
        level: 'ERROR',
        event: 'DELIVERY_TERMINATED_DEAD',
        message: `Delivery marked DEAD: maximum retry attempts (${delivery.attempt_count}) exhausted.`,
      })
    } else if (delivery.state === 'CANCELLED') {
      logs.push({
        timestamp: delivery.updated_at,
        level: 'WARN',
        event: 'DELIVERY_CANCELLED',
        message: 'Delivery was cancelled by user request.',
      })
    } else if (delivery.state === 'RETRYING') {
      logs.push({
        timestamp: delivery.updated_at,
        level: 'INFO',
        event: 'DELIVERY_RETRY_SCHEDULED',
        message: `Delivery queued for retry. Next attempt scheduled at ${delivery.next_attempt_at}.`,
      })
    }

    return {
      deliveryId: id,
      state: delivery.state,
      attemptCount: delivery.attempt_count,
      diagnostics: delivery.diagnostics,
      logs,
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

  // --- Scheduled Deliveries & Bulk Operations ---
  scheduleDelivery(data: ScheduleDeliveryInput): Delivery {
    const scheduledTime = data.scheduledAt || data.scheduled_at
    if (!scheduledTime) throw new Error('scheduledAt is required')
    const targetTime = new Date(scheduledTime).getTime()
    if (isNaN(targetTime) || targetTime <= Date.now()) {
      throw new Error('scheduledAt must be a valid future ISO-8601 date')
    }
    const endpointId = data.endpointId || data.endpoint_id
    if (!endpointId) throw new Error('endpointId is required')
    const ep = this.getEndpoint(endpointId)
    if (!ep) throw new Error(`Endpoint ${endpointId} not found`)

    let eventId = data.eventId || data.event_id
    if (!eventId) {
      const payload = (data.payload as Record<string, unknown>) || { event: 'scheduled.webhook' }
      const newEv: WebhookEvent = {
        id: `ev-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`,
        tenant_id: MOCK_TENANT.id,
        idempotency_key: data.idempotencyKey || data.idempotency_key || `idemp-${Date.now()}`,
        event_type: 'scheduled.event',
        payload,
        created_at: new Date().toISOString(),
        delivery_count: 1,
        succeeded_count: 0,
        failed_count: 0,
      }
      this.events.unshift(newEv)
      eventId = newEv.id
    }

    const seq = ep.next_seq || 1
    ep.next_seq = seq + 1

    const deliveryId = `del-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`
    const newDelivery: Delivery = {
      id: deliveryId,
      event_id: eventId,
      eventId,
      endpoint_id: ep.id,
      endpointId: ep.id,
      seq,
      state: 'SCHEDULED',
      attempt_count: 0,
      attemptCount: 0,
      next_attempt_at: new Date(targetTime).toISOString(),
      nextAttemptAt: new Date(targetTime).toISOString(),
      scheduled_at: new Date(targetTime).toISOString(),
      scheduledAt: new Date(targetTime).toISOString(),
      lease_until: null,
      last_error: null,
      created_at: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      endpoint_url: ep.url,
      endpointUrl: ep.url,
      last_status_code: null,
      lastStatusCode: null,
      endpoint: ep,
    }

    this.deliveries.unshift(newDelivery)
    this.attempts[deliveryId] = []
    return newDelivery
  }

  getScheduledDeliveries(filter?: DeliveryQueryParams): PaginatedList<Delivery> {
    return this.getDeliveries({ ...filter, state: 'SCHEDULED' })
  }

  cancelScheduledDelivery(id: string): { success: boolean; message: string; delivery?: Delivery } {
    const delivery = this.deliveries.find((d) => d.id === id)
    if (!delivery) {
      throw new Error(`Delivery ${id} not found`)
    }
    if (delivery.state !== 'SCHEDULED' && delivery.state !== 'PENDING') {
      throw new Error(
        `Cannot cancel delivery in state ${delivery.state}. Only SCHEDULED or PENDING deliveries can be cancelled.`
      )
    }
    delivery.state = 'CANCELLED'
    delivery.updated_at = new Date().toISOString()
    delivery.updatedAt = delivery.updated_at
    return {
      success: true,
      message: 'Scheduled delivery cancelled successfully',
      delivery,
    }
  }

  bulkReplayDeliveries(deliveryIds: string[]): BulkReplayResult {
    const uniqueIds = Array.from(new Set(deliveryIds || []))
    const successful: Delivery[] = []
    const ineligible: { id: string; deliveryId: string; state: string; reason: string }[] = []
    const rejected: { id: string; deliveryId: string; reason: string }[] = []

    for (const id of uniqueIds) {
      const delivery = this.deliveries.find((d) => d.id === id)
      if (!delivery) {
        rejected.push({
          id,
          deliveryId: id,
          reason: 'Delivery not found or access denied',
        })
        continue
      }

      if (delivery.state !== 'DEAD') {
        ineligible.push({
          id,
          deliveryId: id,
          state: delivery.state,
          reason: `Delivery is in state ${delivery.state}; only DEAD deliveries are eligible for replay`,
        })
        continue
      }

      // Replay dead delivery
      delivery.state = 'PENDING'
      delivery.next_attempt_at = new Date().toISOString()
      delivery.nextAttemptAt = delivery.next_attempt_at
      delivery.updated_at = new Date().toISOString()
      delivery.updatedAt = delivery.updated_at
      delivery.last_error = null
      delivery.lastError = null

      const nextAttemptNo = (delivery.attempt_count || 0) + 1
      const newAttempt: DeliveryAttempt = {
        id: Date.now() + Math.floor(Math.random() * 1000),
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

      successful.push(delivery)
    }

    return {
      success: true,
      message: 'Bulk replay completed',
      total: uniqueIds.length,
      successful,
      replayed: successful,
      ineligible,
      rejected,
      summary: {
        total: uniqueIds.length,
        successfulCount: successful.length,
        replayedCount: successful.length,
        ineligibleCount: ineligible.length,
        rejectedCount: rejected.length,
      },
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
    const pendingOnly = dels.filter((d) => d.state === 'PENDING').length
    const inFlight = dels.filter((d) => d.state === 'IN_FLIGHT').length
    const retrying = dels.filter((d) => d.state === 'RETRYING').length
    const pending = pendingOnly + inFlight + retrying

    const successRate = totalDeliveries > 0 ? (succeeded / totalDeliveries) * 100 : 100
    const activeEndpoints = this.endpoints.filter((e) => e.active).length
    const openCircuits = this.endpoints.filter((e) => e.circuit_state === 'OPEN').length

    return {
      totalEvents: evts.length,
      totalDeliveries,
      succeededDeliveries: succeeded,
      failedDeliveries: failed,
      pendingDeliveries: pending,
      pendingCount: pendingOnly,
      inFlightCount: inFlight,
      retryingCount: retrying,
      queueBacklog: pendingOnly + retrying,
      currentlyProcessing: inFlight,
      deadLetterCount: failed,
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

  // --- Webhook Templates ---

  getTemplates(filter?: { type?: 'all' | 'system' | 'custom'; search?: string }): WebhookTemplate[] {
    let list = [...this.templates]

    if (filter?.type === 'system') {
      list = list.filter((t) => t.is_system)
    } else if (filter?.type === 'custom') {
      list = list.filter((t) => !t.is_system)
    }

    if (filter?.search && filter.search.trim()) {
      const q = filter.search.trim().toLowerCase()
      list = list.filter(
        (t) =>
          (t.name && t.name.toLowerCase().includes(q)) ||
          (t.description && t.description.toLowerCase().includes(q))
      )
    }

    return list
  }

  getTemplate(id: string): WebhookTemplate | undefined {
    return this.templates.find((t) => t.id === id)
  }

  createTemplate(data: CreateTemplateInput): WebhookTemplate {
    const trimmedName = (data.name || '').trim()
    if (!trimmedName) {
      throw new Error('Template name is required')
    }
    if (trimmedName.length > 100) {
      throw new Error('Template name must not exceed 100 characters')
    }

    const strategy = (
      data.retryStrategy ||
      data.retry_strategy ||
      data.retryPolicy?.strategy ||
      'EXPONENTIAL'
    ) as RetryStrategy

    const maxAttempts =
      data.retryMaxAttempts ??
      data.retry_max_attempts ??
      data.retryPolicy?.maxAttempts ??
      8

    const baseDelayMs =
      data.retryBaseDelayMs ??
      data.retry_base_delay_ms ??
      data.retryPolicy?.baseDelayMs ??
      5000

    const maxDelayMs =
      data.retryMaxDelayMs ??
      data.retry_max_delay_ms ??
      data.retryPolicy?.maxDelayMs ??
      (strategy === 'FIXED' ? baseDelayMs : 3600000)

    const backoffMultiplier =
      data.retryBackoffMultiplier ??
      data.retry_backoff_multiplier ??
      data.retryPolicy?.backoffMultiplier ??
      (strategy === 'FIXED' ? 1.0 : 2.0)

    const headers = data.customHeaders ?? data.custom_headers ?? {}
    const payload = data.defaultPayload !== undefined ? data.defaultPayload : data.default_payload
    const method = (data.httpMethod || data.http_method || 'POST').toUpperCase()
    const rateLimit = data.rateLimitRps ?? data.rate_limit_rps ?? 10

    const newTemplate: WebhookTemplate = {
      id: `tmpl-${Math.floor(10000000 + Math.random() * 90000000)}`,
      tenant_id: MOCK_TENANT.id,
      tenantId: MOCK_TENANT.id,
      name: trimmedName,
      description: data.description || '',
      http_method: method,
      httpMethod: method,
      url: data.url || null,
      custom_headers: headers,
      customHeaders: headers,
      default_payload: payload,
      defaultPayload: payload,
      rate_limit_rps: rateLimit,
      rateLimitRps: rateLimit,
      retry_strategy: strategy,
      retryStrategy: strategy,
      retry_max_attempts: maxAttempts,
      retryMaxAttempts: maxAttempts,
      retry_base_delay_ms: baseDelayMs,
      retryBaseDelayMs: baseDelayMs,
      retry_max_delay_ms: maxDelayMs,
      retryMaxDelayMs: maxDelayMs,
      retry_backoff_multiplier: backoffMultiplier,
      retryBackoffMultiplier: backoffMultiplier,
      retry_policy: {
        strategy,
        maxAttempts,
        baseDelayMs,
        maxDelayMs,
        backoffMultiplier,
      },
      retryPolicy: {
        strategy,
        maxAttempts,
        baseDelayMs,
        maxDelayMs,
        backoffMultiplier,
      },
      is_system: false,
      isSystem: false,
      created_at: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    this.templates.unshift(newTemplate)
    return newTemplate
  }

  updateTemplate(id: string, updates: UpdateTemplateInput): WebhookTemplate | null {
    const idx = this.templates.findIndex((t) => t.id === id)
    if (idx === -1) return null

    const existing = this.templates[idx]
    if (existing.is_system) {
      throw new Error('System templates cannot be modified or deleted')
    }

    const trimmedName = updates.name !== undefined ? updates.name.trim() : existing.name
    if (!trimmedName) {
      throw new Error('Template name cannot be empty')
    }
    if (trimmedName.length > 100) {
      throw new Error('Template name must not exceed 100 characters')
    }

    const strategy = (
      updates.retryStrategy ||
      updates.retry_strategy ||
      updates.retryPolicy?.strategy ||
      existing.retry_strategy
    ) as RetryStrategy

    const maxAttempts =
      updates.retryMaxAttempts ??
      updates.retry_max_attempts ??
      updates.retryPolicy?.maxAttempts ??
      existing.retry_max_attempts

    const baseDelayMs =
      updates.retryBaseDelayMs ??
      updates.retry_base_delay_ms ??
      updates.retryPolicy?.baseDelayMs ??
      existing.retry_base_delay_ms

    const maxDelayMs =
      updates.retryMaxDelayMs ??
      updates.retry_max_delay_ms ??
      updates.retryPolicy?.maxDelayMs ??
      existing.retry_max_delay_ms

    const backoffMultiplier =
      updates.retryBackoffMultiplier ??
      updates.retry_backoff_multiplier ??
      updates.retryPolicy?.backoffMultiplier ??
      existing.retry_backoff_multiplier

    const headers =
      updates.customHeaders ??
      updates.custom_headers ??
      existing.custom_headers

    const payload =
      updates.defaultPayload !== undefined
        ? updates.defaultPayload
        : updates.default_payload !== undefined
        ? updates.default_payload
        : existing.default_payload

    const method = (
      updates.httpMethod ||
      updates.http_method ||
      existing.http_method
    ).toUpperCase()

    const rateLimit =
      updates.rateLimitRps ??
      updates.rate_limit_rps ??
      existing.rate_limit_rps

    const updated: WebhookTemplate = {
      ...existing,
      name: trimmedName,
      description: updates.description !== undefined ? updates.description : existing.description,
      http_method: method,
      httpMethod: method,
      url: updates.url !== undefined ? updates.url : existing.url,
      custom_headers: headers,
      customHeaders: headers,
      default_payload: payload,
      defaultPayload: payload,
      rate_limit_rps: rateLimit,
      rateLimitRps: rateLimit,
      retry_strategy: strategy,
      retryStrategy: strategy,
      retry_max_attempts: maxAttempts,
      retryMaxAttempts: maxAttempts,
      retry_base_delay_ms: baseDelayMs,
      retryBaseDelayMs: baseDelayMs,
      retry_max_delay_ms: maxDelayMs,
      retryMaxDelayMs: maxDelayMs,
      retry_backoff_multiplier: backoffMultiplier,
      retryBackoffMultiplier: backoffMultiplier,
      retry_policy: {
        strategy,
        maxAttempts,
        baseDelayMs,
        maxDelayMs,
        backoffMultiplier,
      },
      retryPolicy: {
        strategy,
        maxAttempts,
        baseDelayMs,
        maxDelayMs,
        backoffMultiplier,
      },
      updated_at: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    this.templates[idx] = updated
    return updated
  }

  deleteTemplate(id: string): { success: boolean; id: string; message: string } | null {
    const idx = this.templates.findIndex((t) => t.id === id)
    if (idx === -1) return null

    const existing = this.templates[idx]
    if (existing.is_system) {
      throw new Error('System templates cannot be modified or deleted')
    }

    this.templates.splice(idx, 1)
    return {
      success: true,
      id,
      message: 'Template deleted successfully',
    }
  }

  applyTemplate(id: string, overrides: Record<string, any> = {}): TemplateApplyResult {
    const template = this.getTemplate(id)
    if (!template) {
      throw new Error('Template not found')
    }

    const nested = overrides.retryPolicy || overrides.retry_policy || {}
    const strategy = (
      overrides.retryStrategy ||
      overrides.retry_strategy ||
      nested.strategy ||
      template.retry_strategy
    ) as RetryStrategy

    const maxAttempts =
      overrides.retryMaxAttempts ??
      overrides.retry_max_attempts ??
      nested.maxAttempts ??
      template.retry_max_attempts

    const baseDelayMs =
      overrides.retryBaseDelayMs ??
      overrides.retry_base_delay_ms ??
      nested.baseDelayMs ??
      template.retry_base_delay_ms

    const maxDelayMs =
      overrides.retryMaxDelayMs ??
      overrides.retry_max_delay_ms ??
      nested.maxDelayMs ??
      template.retry_max_delay_ms

    const backoffMultiplier =
      overrides.retryBackoffMultiplier ??
      overrides.retry_backoff_multiplier ??
      nested.backoffMultiplier ??
      template.retry_backoff_multiplier

    const effectiveUrl =
      overrides.url !== undefined && overrides.url !== null && String(overrides.url).trim()
        ? String(overrides.url).trim()
        : template.url

    const overrideHeaders =
      overrides.customHeaders || overrides.custom_headers || overrides.headers || {}
    const mergedHeaders: Record<string, string> = {
      ...template.custom_headers,
      ...overrideHeaders,
    }

    // Redact sensitive headers
    const sanitizedHeaders: Record<string, string> = {}
    const sensitiveRegex = /^(authorization|x-api-key|cookie|x-webhook-secret|token|api-key)/i
    for (const [key, val] of Object.entries(mergedHeaders)) {
      if (sensitiveRegex.test(key)) {
        sanitizedHeaders[key] = '[REDACTED]'
      } else {
        sanitizedHeaders[key] = String(val)
      }
    }

    const payload =
      overrides.defaultPayload !== undefined
        ? overrides.defaultPayload
        : overrides.default_payload !== undefined
        ? overrides.default_payload
        : template.default_payload

    const rateLimit =
      overrides.rateLimitRps ??
      overrides.rate_limit_rps ??
      template.rate_limit_rps

    const method = (
      overrides.httpMethod ||
      overrides.http_method ||
      template.http_method
    ).toUpperCase()

    return {
      templateId: template.id,
      templateName: template.name,
      url: effectiveUrl,
      httpMethod: method,
      customHeaders: sanitizedHeaders,
      defaultPayload: payload,
      rateLimitRps: rateLimit,
      retryStrategy: strategy,
      retryMaxAttempts: maxAttempts,
      retryBaseDelayMs: baseDelayMs,
      retryMaxDelayMs: maxDelayMs,
      retryBackoffMultiplier: backoffMultiplier,
      retryPolicy: {
        strategy,
        maxAttempts,
        baseDelayMs,
        maxDelayMs,
        backoffMultiplier,
      },
    }
  }

  createEndpointFromTemplate(id: string, overrides: Record<string, any> = {}): Endpoint {
    const applied = this.applyTemplate(id, overrides)
    if (!applied.url) {
      throw new Error('Destination URL is required to create an endpoint from template')
    }

    return this.createEndpoint({
      url: applied.url,
      rate_limit_rps: applied.rateLimitRps,
      description: `Created from template: ${applied.templateName}`,
      retryStrategy: applied.retryStrategy,
      retryMaxAttempts: applied.retryMaxAttempts,
      retryBaseDelayMs: applied.retryBaseDelayMs,
      retryMaxDelayMs: applied.retryMaxDelayMs,
      retryBackoffMultiplier: applied.retryBackoffMultiplier,
      templateId: id,
    })
  }
}

export const mockStore = new MockStore()
