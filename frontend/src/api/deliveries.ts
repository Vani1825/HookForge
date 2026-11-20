import { apiClient } from './client'
import type { Delivery, PaginationMeta, ScheduleDeliveryInput, BulkReplayResult } from '../types'

export type { ScheduleDeliveryInput, BulkReplayResult }

export interface DeliveryQueryParams {
  state?: string
  endpoint_id?: string
  event_id?: string
  page?: number
  pageSize?: number
  limit?: number
  offset?: number
  created_after?: string
  created_before?: string
  q?: string
}

export interface PaginatedList<T> extends Array<T> {
  data: T[]
  pagination: PaginationMeta
}

export function createPaginatedList<T>(items: T[], pagination: PaginationMeta): PaginatedList<T> {
  const list = [...items] as PaginatedList<T>
  list.data = items
  list.pagination = pagination
  return list
}

function normalizeDelivery(d: any): Delivery {
  if (!d || typeof d !== 'object') return d
  return {
    ...d,
    event_id: d.event_id || d.eventId,
    eventId: d.eventId || d.event_id,
    endpoint_id: d.endpoint_id || d.endpointId,
    endpointId: d.endpointId || d.endpoint_id,
    endpoint_url: d.endpoint_url || d.endpointUrl,
    endpointUrl: d.endpointUrl || d.endpoint_url,
    last_status_code: d.last_status_code !== undefined ? d.last_status_code : d.lastStatusCode ?? null,
    lastStatusCode: d.lastStatusCode !== undefined ? d.lastStatusCode : d.last_status_code ?? null,
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
    scheduled_at: d.scheduled_at || d.scheduledAt || null,
    scheduledAt: d.scheduledAt || d.scheduled_at || null,
    attempts: Array.isArray(d.attempts) ? d.attempts : [],
  }
}

export async function fetchDeliveries(params?: DeliveryQueryParams): Promise<PaginatedList<Delivery>> {
  const queryParams: Record<string, string | number | boolean> = {}
  if (params) {
    queryParams.state = params.state || 'ALL'
    if (params.endpoint_id) queryParams.endpoint_id = params.endpoint_id
    if (params.event_id) queryParams.event_id = params.event_id
    if (params.page !== undefined) queryParams.page = params.page
    if (params.pageSize !== undefined) queryParams.pageSize = params.pageSize
    if (params.limit !== undefined) queryParams.limit = params.limit
    if (params.offset !== undefined) queryParams.offset = params.offset
    if (params.created_after) queryParams.created_after = params.created_after
    if (params.created_before) queryParams.created_before = params.created_before
    if (params.q) queryParams.q = params.q
  } else {
    // When no state is specified, request ALL deliveries
    queryParams.state = 'ALL'
  }

  const res = await apiClient.get<any>('/deliveries', {
    params: queryParams,
  })

  let rawList: any[] = []
  if (Array.isArray(res)) {
    rawList = res
  } else if (res && Array.isArray(res.data)) {
    rawList = res.data
  } else if (res && Array.isArray(res.deliveries)) {
    rawList = res.deliveries
  }

  const normalizedItems = rawList.map(normalizeDelivery)

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

export async function fetchDeliveryById(id: string): Promise<Delivery> {
  const res = await apiClient.get<Delivery>(`/deliveries/${id}`)
  return normalizeDelivery(res)
}

export async function fetchDeliveriesByEvent(eventId: string): Promise<Delivery[]> {
  const res = await apiClient.get<Delivery[] | { deliveries: Delivery[] }>(`/events/${eventId}/deliveries`)
  let rawList: Delivery[] = []
  if (Array.isArray(res)) {
    rawList = res
  } else if (res && Array.isArray((res as any).data)) {
    rawList = (res as any).data
  } else if (res && Array.isArray((res as { deliveries?: Delivery[] }).deliveries)) {
    rawList = (res as { deliveries: Delivery[] }).deliveries
  }
  return rawList.map(normalizeDelivery)
}

export async function fetchDeadLetterDeliveries(): Promise<Delivery[]> {
  return fetchDeliveries({ state: 'DEAD' })
}

export async function replayDelivery(id: string): Promise<{ success: boolean; message: string; delivery?: Delivery }> {
  const res = await apiClient.post<any>(`/deliveries/${id}/replay`)
  if (res && typeof res === 'object') {
    const rawDelivery = res.delivery || (res.id ? res : undefined)
    return {
      success: res.success !== undefined ? Boolean(res.success) : true,
      message: res.message || 'Delivery replayed successfully',
      delivery: rawDelivery ? normalizeDelivery(rawDelivery) : undefined,
    }
  }
  return {
    success: true,
    message: 'Delivery replayed successfully',
  }
}

export async function scheduleDelivery(data: ScheduleDeliveryInput): Promise<Delivery> {
  const body = {
    endpointId: data.endpointId || data.endpoint_id,
    scheduledAt: data.scheduledAt || data.scheduled_at,
    payload: data.payload,
    eventId: data.eventId || data.event_id,
    idempotencyKey: data.idempotencyKey || data.idempotency_key,
  }
  const res = await apiClient.post<any>('/deliveries/schedule', body)
  const rawDelivery = res.delivery || (res.id ? res : res.data ? res.data : res)
  return normalizeDelivery(rawDelivery)
}

export async function fetchScheduledDeliveries(params?: DeliveryQueryParams): Promise<PaginatedList<Delivery>> {
  const queryParams: Record<string, string | number | boolean> = {}
  if (params) {
    if (params.endpoint_id) queryParams.endpoint_id = params.endpoint_id
    if (params.event_id) queryParams.event_id = params.event_id
    if (params.page !== undefined) queryParams.page = params.page
    if (params.pageSize !== undefined) queryParams.pageSize = params.pageSize
    if (params.limit !== undefined) queryParams.limit = params.limit
    if (params.offset !== undefined) queryParams.offset = params.offset
    if (params.created_after) queryParams.created_after = params.created_after
    if (params.created_before) queryParams.created_before = params.created_before
    if (params.q) queryParams.q = params.q
  }

  const res = await apiClient.get<any>('/deliveries/scheduled', {
    params: queryParams,
  })

  let rawList: any[] = []
  if (Array.isArray(res)) {
    rawList = res
  } else if (res && Array.isArray(res.data)) {
    rawList = res.data
  } else if (res && Array.isArray(res.deliveries)) {
    rawList = res.deliveries
  }

  const normalizedItems = rawList.map(normalizeDelivery)

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

export async function fetchScheduledDeliveryById(id: string): Promise<Delivery> {
  const res = await apiClient.get<any>(`/deliveries/scheduled/${id}`)
  const rawDelivery = res.delivery || (res.id ? res : res)
  return normalizeDelivery(rawDelivery)
}

export async function cancelScheduledDelivery(id: string): Promise<{ success: boolean; message: string; delivery?: Delivery }> {
  const res = await apiClient.post<any>(`/deliveries/${id}/cancel`)
  const rawDelivery = res.delivery || (res.id ? res : undefined)
  return {
    success: res.success !== undefined ? Boolean(res.success) : true,
    message: res.message || 'Scheduled delivery cancelled successfully',
    delivery: rawDelivery ? normalizeDelivery(rawDelivery) : undefined,
  }
}

export async function bulkReplayDeliveries(deliveryIds: string[]): Promise<BulkReplayResult> {
  const res = await apiClient.post<any>('/deliveries/bulk-replay', {
    deliveryIds,
  })

  const rawSuccessful = Array.isArray(res.successful)
    ? res.successful
    : Array.isArray(res.replayed)
    ? res.replayed
    : []

  const successful = rawSuccessful.map(normalizeDelivery)
  const ineligible = Array.isArray(res.ineligible) ? res.ineligible : []
  const rejected = Array.isArray(res.rejected) ? res.rejected : []

  const summary = res.summary || {
    total: res.total || deliveryIds.length,
    successfulCount: successful.length,
    replayedCount: successful.length,
    ineligibleCount: ineligible.length,
    rejectedCount: rejected.length,
  }

  return {
    success: res.success !== undefined ? Boolean(res.success) : true,
    message: res.message || 'Bulk replay completed',
    total: res.total || deliveryIds.length,
    successful,
    replayed: successful,
    ineligible,
    rejected,
    summary,
  }
}
