import { apiClient } from './client'
import type { Delivery } from '../types'

export interface DeliveryQueryParams {
  state?: string
  endpoint_id?: string
  event_id?: string
  limit?: number
  offset?: number
}

function normalizeDelivery(d: any): Delivery {
  if (!d || typeof d !== 'object') return d
  return {
    ...d,
    event_id: d.event_id || d.eventId,
    eventId: d.eventId || d.event_id,
    endpoint_id: d.endpoint_id || d.endpointId,
    endpointId: d.endpointId || d.endpoint_id,
    attempt_count: d.attempt_count !== undefined ? d.attempt_count : d.attemptCount ?? 0,
    attemptCount: d.attemptCount !== undefined ? d.attemptCount : d.attempt_count ?? 0,
    next_attempt_at: d.next_attempt_at || d.nextAttemptAt,
    nextAttemptAt: d.nextAttemptAt || d.next_attempt_at,
    last_error: d.last_error !== undefined ? d.last_error : d.lastError,
    lastError: d.lastError !== undefined ? d.lastError : d.last_error,
    created_at: d.created_at || d.createdAt,
    createdAt: d.createdAt || d.created_at,
    updated_at: d.updated_at || d.updatedAt,
    updatedAt: d.updatedAt || d.updated_at,
    attempts: Array.isArray(d.attempts) ? d.attempts : [],
  }
}

export async function fetchDeliveries(params?: DeliveryQueryParams): Promise<Delivery[]> {
  const queryParams: Record<string, string | number | boolean> = {}
  if (params) {
    if (params.state) queryParams.state = params.state
    if (params.endpoint_id) queryParams.endpoint_id = params.endpoint_id
    if (params.event_id) queryParams.event_id = params.event_id
    if (params.limit) queryParams.limit = params.limit
    if (params.offset) queryParams.offset = params.offset
  } else {
    // When no state is specified, request ALL deliveries
    queryParams.state = 'ALL'
  }

  const res = await apiClient.get<Delivery[] | { deliveries: Delivery[] }>('/deliveries', {
    params: queryParams,
  })

  let rawList: Delivery[] = []
  if (Array.isArray(res)) {
    rawList = res
  } else if (res && Array.isArray((res as { deliveries?: Delivery[] }).deliveries)) {
    rawList = (res as { deliveries: Delivery[] }).deliveries
  }

  return rawList.map(normalizeDelivery)
}

export async function fetchDeliveryById(id: string): Promise<Delivery> {
  const res = await apiClient.get<Delivery>(`/deliveries/${id}`)
  return normalizeDelivery(res)
}

export async function fetchDeliveriesByEvent(eventId: string): Promise<Delivery[]> {
  const res = await apiClient.get<Delivery[] | { deliveries: Delivery[] }>(`/events/${eventId}/deliveries`)
  let rawList: Delivery[] = []
  if (Array.isArray(res)) {
    rawList = res
  } else if (res && Array.isArray((res as { deliveries?: Delivery[] }).deliveries)) {
    rawList = (res as { deliveries: Delivery[] }).deliveries
  }
  return rawList.map(normalizeDelivery)
}

export async function fetchDeadLetterDeliveries(): Promise<Delivery[]> {
  return fetchDeliveries({ state: 'DEAD' })
}

export async function replayDelivery(id: string): Promise<{ success: boolean; message: string; delivery?: Delivery }> {
  return apiClient.post<{ success: boolean; message: string; delivery?: Delivery }>(`/deliveries/${id}/replay`)
}
