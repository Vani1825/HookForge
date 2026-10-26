import { apiClient } from './client'
import type { WebhookEvent, IngestResult } from '../types'

export interface IngestEventInput {
  idempotency_key: string
  payload: Record<string, unknown>
  event_type?: string
}

export async function fetchEvents(): Promise<WebhookEvent[]> {
  return apiClient.get<WebhookEvent[]>('/events')
}

export async function fetchEventById(id: string): Promise<WebhookEvent> {
  return apiClient.get<WebhookEvent>(`/events/${id}`)
}

export async function ingestEvent(input: IngestEventInput): Promise<IngestResult> {
  return apiClient.post<IngestResult>('/events', input.payload, {
    headers: {
      'Idempotency-Key': input.idempotency_key,
    },
  })
}
