import { apiClient } from './client'
import type { Delivery } from '../types'

export interface DeliveryQueryParams {
  state?: string
  endpoint_id?: string
  event_id?: string
  limit?: number
  offset?: number
}

export async function fetchDeliveries(params?: DeliveryQueryParams): Promise<Delivery[]> {
  return apiClient.get<Delivery[]>('/deliveries', {
    params: params as Record<string, string | number | boolean>,
  })
}

export async function fetchDeliveryById(id: string): Promise<Delivery> {
  return apiClient.get<Delivery>(`/deliveries/${id}`)
}

export async function fetchDeliveriesByEvent(eventId: string): Promise<Delivery[]> {
  return apiClient.get<Delivery[]>(`/events/${eventId}/deliveries`)
}

export async function fetchDeadLetterDeliveries(): Promise<Delivery[]> {
  return apiClient.get<Delivery[]>('/deliveries', {
    params: { state: 'DEAD' },
  })
}

export async function replayDelivery(id: string): Promise<{ success: boolean; message: string; delivery?: Delivery }> {
  return apiClient.post<{ success: boolean; message: string; delivery?: Delivery }>(`/deliveries/${id}/replay`)
}
