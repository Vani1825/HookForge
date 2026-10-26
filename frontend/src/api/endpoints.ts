import { apiClient } from './client'
import type { Endpoint } from '../types'

export interface CreateEndpointInput {
  url: string
  rate_limit_rps?: number
  description?: string
}

export interface UpdateEndpointInput {
  url?: string
  rate_limit_rps?: number
  active?: boolean
  description?: string
}

export async function fetchEndpoints(): Promise<Endpoint[]> {
  return apiClient.get<Endpoint[]>('/endpoints')
}

export async function fetchEndpointById(id: string): Promise<Endpoint> {
  return apiClient.get<Endpoint>(`/endpoints/${id}`)
}

export async function createEndpoint(input: CreateEndpointInput): Promise<Endpoint> {
  return apiClient.post<Endpoint>('/endpoints', input)
}

export async function updateEndpoint(id: string, input: UpdateEndpointInput): Promise<Endpoint> {
  return apiClient.patch<Endpoint>(`/endpoints/${id}`, input)
}

export async function toggleEndpointActive(id: string, active: boolean): Promise<Endpoint> {
  return apiClient.patch<Endpoint>(`/endpoints/${id}`, { active })
}

export async function deleteEndpoint(id: string): Promise<{ success: boolean }> {
  return apiClient.delete<{ success: boolean }>(`/endpoints/${id}`)
}
