import { apiClient } from './client'
import type { WebhookEvent, IngestResult, PaginationMeta } from '../types'
import { createPaginatedList, type PaginatedList } from './deliveries'

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

export interface EventQueryParams {
  page?: number
  pageSize?: number
  limit?: number
  offset?: number
  idempotency_key?: string
  created_after?: string
  created_before?: string
  q?: string
}

export async function fetchEvents(params?: EventQueryParams): Promise<PaginatedList<WebhookEvent>> {
  const queryParams: Record<string, string | number | boolean | undefined | null> = {}
  if (params) {
    if (params.page !== undefined) queryParams.page = params.page
    if (params.pageSize !== undefined) queryParams.pageSize = params.pageSize
    if (params.limit !== undefined) queryParams.limit = params.limit
    if (params.offset !== undefined) queryParams.offset = params.offset
    if (params.idempotency_key) queryParams.idempotency_key = params.idempotency_key
    if (params.created_after) queryParams.created_after = params.created_after
    if (params.created_before) queryParams.created_before = params.created_before
    if (params.q) queryParams.q = params.q
  }

  const res = await apiClient.get<any>('/events', { params: queryParams })
  let rawList: any[] = []
  if (Array.isArray(res)) {
    rawList = res
  } else if (res && Array.isArray(res.data)) {
    rawList = res.data
  } else if (res && Array.isArray(res.events)) {
    rawList = res.events
  }

  const normalizedItems = rawList.map(normalizeEvent)

  let pagination: PaginationMeta
  if (res && res.pagination && typeof res.pagination === 'object') {
    pagination = {
      page: Number(res.pagination.page) || 1,
      pageSize: Number(res.pagination.pageSize) || 20,
      totalRecords: Number(res.pagination.totalRecords) || 0,
      totalPages: Number(res.pagination.totalPages) || 0,
      hasNext: Boolean(res.pagination.hasNext),
      hasPrev: Boolean(res.pagination.hasPrev),
      ...(res.pagination.offset !== undefined ? { offset: Number(res.pagination.offset) } : {}),
    }
  } else {
    const page = params?.page || 1
    const pageSize = params?.pageSize || params?.limit || (normalizedItems.length > 0 ? normalizedItems.length : 20)
    const totalRecords = normalizedItems.length
    const totalPages = totalRecords === 0 ? 0 : Math.ceil(totalRecords / pageSize)
    pagination = {
      page,
      pageSize,
      totalRecords,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    }
  }

  return createPaginatedList(normalizedItems, pagination)
}

export async function fetchEventById(id: string): Promise<WebhookEvent> {
  const res = await apiClient.get<WebhookEvent>(`/events/${id}`)
  return normalizeEvent(res)
}

export async function ingestEvent(input: IngestEventInput): Promise<IngestResult> {
  const res = await apiClient.post<any>('/events', input.payload, {
    headers: {
      'Idempotency-Key': input.idempotency_key,
    },
  })
  return {
    duplicate: Boolean(res?.duplicate),
    deliveriesEnqueued: typeof res?.deliveriesEnqueued === 'number' ? res.deliveriesEnqueued : 0,
    eventId: res?.eventId || res?.id,
  }
}
