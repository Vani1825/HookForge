import { apiClient } from './client'
import type { Endpoint, EndpointTestInput, EndpointTestResult, EndpointTestResponseData } from '../types'

export type { EndpointTestInput, EndpointTestResult, EndpointTestResponseData }

export interface CreateEndpointInput {
  url: string
  rate_limit_rps?: number
  rateLimitRps?: number
  description?: string
}

export interface UpdateEndpointInput {
  url?: string
  rate_limit_rps?: number
  rateLimitRps?: number
  active?: boolean
  description?: string
}

function normalizeEndpoint(ep: any): Endpoint {
  if (!ep || typeof ep !== 'object') return ep
  const circuit = ep.circuit_state || ep.circuitState || 'CLOSED'
  return {
    ...ep,
    tenant_id: ep.tenant_id || ep.tenantId,
    rate_limit_rps: ep.rate_limit_rps !== undefined ? ep.rate_limit_rps : ep.rateLimitRps ?? 10,
    circuit_state: circuit,
    consecutive_failures: ep.consecutive_failures !== undefined ? ep.consecutive_failures : ep.consecutiveFailures ?? 0,
    created_at: ep.created_at || ep.createdAt,
    next_seq: ep.next_seq !== undefined ? ep.next_seq : ep.nextSeq ?? 1,
  }
}

export async function fetchEndpoints(): Promise<Endpoint[]> {
  const res = await apiClient.get<Endpoint[]>('/endpoints')
  if (Array.isArray(res)) {
    return res.map(normalizeEndpoint)
  }
  return []
}

export async function fetchEndpointById(id: string): Promise<Endpoint> {
  const res = await apiClient.get<Endpoint>(`/endpoints/${id}`)
  return normalizeEndpoint(res)
}

export async function createEndpoint(input: CreateEndpointInput): Promise<Endpoint> {
  const payload = {
    ...input,
    rateLimitRps: input.rateLimitRps ?? input.rate_limit_rps ?? 10,
    rate_limit_rps: input.rate_limit_rps ?? input.rateLimitRps ?? 10,
  }
  const res = await apiClient.post<Endpoint>('/endpoints', payload)
  return normalizeEndpoint(res)
}

export async function updateEndpoint(id: string, input: UpdateEndpointInput): Promise<Endpoint> {
  const payload = {
    ...input,
    rateLimitRps: input.rateLimitRps ?? input.rate_limit_rps,
    rate_limit_rps: input.rate_limit_rps ?? input.rateLimitRps,
  }
  const res = await apiClient.patch<Endpoint>(`/endpoints/${id}`, payload)
  return normalizeEndpoint(res)
}

export async function toggleEndpointActive(id: string, active: boolean): Promise<Endpoint> {
  const res = await apiClient.patch<Endpoint>(`/endpoints/${id}`, { active })
  return normalizeEndpoint(res)
}

export async function deleteEndpoint(id: string): Promise<{ success: boolean }> {
  return apiClient.delete<{ success: boolean }>(`/endpoints/${id}`)
}

/**
 * Normalizes endpoint test response from backend, ensuring both camelCase and snake_case compatibility.
 */
export function normalizeTestResult(res: any): EndpointTestResult {
  if (!res || typeof res !== 'object') {
    return {
      success: false,
      statusCode: null,
      status_code: null,
      latencyMs: 0,
      latency_ms: 0,
      error: 'Invalid test response from server',
      request: { url: '', method: 'POST', headers: {}, payload: null },
      response: null,
      testedAt: new Date().toISOString(),
      tested_at: new Date().toISOString(),
    }
  }

  const statusCode = res.statusCode !== undefined ? res.statusCode : res.status_code ?? null
  const latencyMs = res.latencyMs !== undefined ? res.latencyMs : res.latency_ms ?? 0
  const testedAt = res.testedAt || res.tested_at || new Date().toISOString()

  let responseData: EndpointTestResponseData | null = null
  if (res.response && typeof res.response === 'object') {
    const respStatus =
      res.response.statusCode !== undefined
        ? res.response.statusCode
        : res.response.status_code ?? statusCode
    const sizeBytes =
      res.response.sizeBytes !== undefined
        ? res.response.sizeBytes
        : res.response.size_bytes ?? 0

    responseData = {
      statusCode: respStatus,
      status_code: respStatus,
      headers: res.response.headers || {},
      body: res.response.body !== undefined ? res.response.body : null,
      sizeBytes,
      size_bytes: sizeBytes,
      truncated: Boolean(res.response.truncated),
    }
  }

  return {
    success: Boolean(res.success),
    statusCode,
    status_code: statusCode,
    latencyMs,
    latency_ms: latencyMs,
    error: res.error || null,
    request: {
      url: res.request?.url || '',
      method: (res.request?.method || 'POST').toUpperCase(),
      headers: res.request?.headers || {},
      payload: res.request?.payload !== undefined ? res.request.payload : null,
    },
    response: responseData,
    testedAt,
    tested_at: testedAt,
  }
}

/**
 * Test a webhook endpoint with custom method, headers, and JSON payload.
 * Supports testing saved endpoints by ID or ad-hoc URLs.
 */
export async function testEndpoint(input: EndpointTestInput): Promise<EndpointTestResult> {
  const endpointId = input.endpointId || input.endpoint_id
  const payload: Record<string, unknown> = {
    method: input.method || 'POST',
    timeoutMs: input.timeoutMs ?? input.timeout_ms ?? 10000,
    timeout_ms: input.timeoutMs ?? input.timeout_ms ?? 10000,
  }

  if (input.url) payload.url = input.url
  if (input.headers) payload.headers = input.headers
  if (input.payload !== undefined) payload.payload = input.payload
  if (input.body !== undefined) payload.body = input.body
  if (input.secret) payload.secret = input.secret

  let rawRes: any
  if (endpointId) {
    payload.endpointId = endpointId
    payload.endpoint_id = endpointId
    rawRes = await apiClient.post<any>(`/endpoints/${endpointId}/test`, payload)
  } else {
    rawRes = await apiClient.post<any>('/endpoints/test', payload)
  }

  return normalizeTestResult(rawRes)
}

/**
 * Convenience helper to test a saved endpoint by ID.
 */
export async function testEndpointById(
  id: string,
  input: Omit<EndpointTestInput, 'endpointId' | 'endpoint_id'> = {}
): Promise<EndpointTestResult> {
  return testEndpoint({ ...input, endpointId: id })
}
