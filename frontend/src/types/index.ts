/**
 * HookForge Domain and API Types
 * Modeled directly on the PostgreSQL schema (migrations/V1__init.sql)
 * and backend domain models.
 */

export type DeliveryState = 'PENDING' | 'IN_FLIGHT' | 'RETRYING' | 'SUCCEEDED' | 'DEAD' | 'SCHEDULED' | 'CANCELLED'

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN'

export interface Tenant {
  id: string
  name: string
  api_key_hash?: string
  created_at: string
}

export interface Endpoint {
  id: string
  tenant_id: string
  url: string
  secret?: string // Only returned upon endpoint creation
  active: boolean
  rate_limit_rps: number
  next_seq?: number
  circuit_state: CircuitState
  circuit_until?: string | null
  consecutive_failures: number
  created_at: string
  // Virtual / calculated metrics
  description?: string
  total_deliveries?: number
  success_rate?: number
}

export interface WebhookEvent {
  id: string
  tenant_id: string
  payload: Record<string, unknown> | unknown[]
  idempotency_key: string
  created_at: string
  // Enriched frontend fields
  event_type?: string
  delivery_count?: number
  succeeded_count?: number
  failed_count?: number
}

export interface DeliveryAttempt {
  id: number | string
  delivery_id: string
  attempt_no: number
  started_at: string
  status_code?: number | null // null on network error / timeout
  latency_ms: number
  error?: string | null
}

export interface Delivery {
  id: string
  event_id: string
  endpoint_id: string
  seq: number
  state: DeliveryState
  attempt_count: number
  next_attempt_at: string
  lease_until?: string | null
  last_error?: string | null
  created_at: string
  updated_at: string
  // Enriched relationships
  endpoint_url?: string
  endpointUrl?: string
  endpoint?: Endpoint
  event?: WebhookEvent
  attempts?: DeliveryAttempt[]
  last_status_code?: number | null
  lastStatusCode?: number | null
  // CamelCase aliases
  eventId?: string
  endpointId?: string
  attemptCount?: number
  nextAttemptAt?: string
  lastError?: string | null
  createdAt?: string
  updatedAt?: string
  scheduled_at?: string | null
  scheduledAt?: string | null
}

export interface IngestRequest {
  idempotency_key: string
  payload: Record<string, unknown>
}

export interface IngestResult {
  duplicate: boolean
  deliveriesEnqueued: number
  eventId?: string
}

export interface WorkerHealth {
  status: 'up' | 'down' | 'degraded' | 'unavailable' | 'unknown'
  activeWorkers?: number | null
  currentlyProcessing?: number | null
  lastHeartbeat?: string | null
  error?: string
}

export interface HealthResponse {
  status: 'up' | 'down'
  timestamp: string
  checks?: {
    database?: {
      status: 'up' | 'down'
      error?: string
    }
    worker?: WorkerHealth
  }
}

export interface OverviewMetrics {
  totalEvents: number
  totalDeliveries: number
  succeededDeliveries: number
  failedDeliveries: number
  pendingDeliveries: number
  pendingCount?: number
  inFlightCount?: number
  retryingCount?: number
  queueBacklog?: number
  currentlyProcessing?: number
  deadLetterCount?: number
  successRate: number
  averageLatencyMs: number
  activeEndpoints: number
  totalEndpoints: number
  openCircuits: number
}

export interface TimeSeriesDataPoint {
  timestamp: string
  label: string
  total: number
  succeeded: number
  failed: number
  pending: number
}

export interface StatusDistribution {
  name: string
  value: number
  color: string
}

export interface PaginationMeta {
  page: number
  pageSize: number
  totalRecords: number
  totalPages: number
  hasNext: boolean
  hasPrev: boolean
  offset?: number
}

export interface PaginatedResponse<T> {
  data: T[]
  pagination: PaginationMeta
}

export type NotificationSeverity = 'success' | 'warning' | 'error' | 'info'

export type NotificationCategory =
  | 'delivery_success'
  | 'delivery_failed'
  | 'delivery_retry'
  | 'dead_letter'
  | 'system_health'

export interface AppNotification {
  id: string
  title: string
  description: string
  timestamp: string
  severity: NotificationSeverity
  category: NotificationCategory
  read: boolean
  entityId?: string
  link?: string
  metadata?: {
    endpointUrl?: string
    statusCode?: number | null
    attemptCount?: number
    error?: string | null
    [key: string]: unknown
  }
}

export interface ScheduleDeliveryInput {
  endpointId?: string
  endpoint_id?: string
  scheduledAt?: string
  scheduled_at?: string
  payload?: Record<string, unknown> | unknown[]
  eventId?: string
  event_id?: string
  idempotencyKey?: string
  idempotency_key?: string
}

export interface BulkReplayIneligibleItem {
  id: string
  deliveryId?: string
  state?: string
  reason: string
}

export interface BulkReplayRejectedItem {
  id: string
  deliveryId?: string
  reason: string
}

export interface BulkReplaySummary {
  total: number
  successfulCount: number
  replayedCount?: number
  ineligibleCount: number
  rejectedCount: number
}

export interface BulkReplayResult {
  success: boolean
  message?: string
  total: number
  successful: Delivery[]
  replayed?: Delivery[]
  ineligible: BulkReplayIneligibleItem[]
  rejected: BulkReplayRejectedItem[]
  summary: BulkReplaySummary
}

// ==========================================
// Phase 2, Task 2: Endpoint Testing Types
// ==========================================

export type EndpointTestHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD'

export interface EndpointTestInput {
  endpointId?: string
  endpoint_id?: string
  url?: string
  method?: EndpointTestHttpMethod | string
  headers?: Record<string, string>
  payload?: unknown
  body?: unknown
  secret?: string
  timeoutMs?: number
  timeout_ms?: number
}

export interface EndpointTestRequestSummary {
  url: string
  method: string
  headers: Record<string, string>
  payload: unknown
}

export interface EndpointTestResponseData {
  statusCode: number
  status_code?: number
  headers: Record<string, string>
  body: string | null
  sizeBytes: number
  size_bytes?: number
  truncated: boolean
}

export interface EndpointTestResult {
  success: boolean
  statusCode: number | null
  status_code?: number | null
  latencyMs: number
  latency_ms?: number
  error: string | null
  request: EndpointTestRequestSummary
  response: EndpointTestResponseData | null
  testedAt: string
  tested_at?: string
}
