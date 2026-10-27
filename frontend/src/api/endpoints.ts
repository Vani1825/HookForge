import { apiClient } from './client'
import type { Endpoint } from '../types'

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
