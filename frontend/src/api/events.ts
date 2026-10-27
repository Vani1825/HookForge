import { apiClient } from './client'
import type { WebhookEvent, IngestResult } from '../types'

export interface IngestEventInput {
  idempotency_key: string
  payload: Record<string, unknown>
  event_type?: string
}

function normalizeEvent(e: any): WebhookEvent {
  if (!e || typeof e !== 'object') return e
  return {
    ...e,
    tenant_id: e.tenant_id || e.tenantId,
    idempotency_key: e.idempotency_key || e.idempotencyKey,
    created_at: e.created_at || e.createdAt,
    payload: e.payload,
  }
}

export async function fetchEvents(): Promise<WebhookEvent[]> {
  const res = await apiClient.get<WebhookEvent[]>('/events')
  if (Array.isArray(res)) {
    return res.map(normalizeEvent)
  }
  return []
}

export async function fetchEventById(id: string): Promise<WebhookEvent> {
  const res = await apiClient.get<WebhookEvent>(`/events/${id}`)
  return normalizeEvent(res)
}

export async function ingestEvent(input: IngestEventInput): Promise<IngestResult> {
  return apiClient.post<IngestResult>('/events', input.payload, {
    headers: {
      'Idempotency-Key': input.idempotency_key,
    },
  })
}
