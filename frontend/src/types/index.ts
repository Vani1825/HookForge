/**
 * HookForge Domain and API Types
 * Modeled directly on the PostgreSQL schema (migrations/V1__init.sql)
 * and backend domain models.
 */

export type DeliveryState = 'PENDING' | 'IN_FLIGHT' | 'RETRYING' | 'SUCCEEDED' | 'DEAD' | 'SCHEDULED' | 'CANCELLED'

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN'

export type RetryStrategy = 'EXPONENTIAL' | 'FIXED'

export interface RetryPolicy {
  strategy: RetryStrategy
  maxAttempts: number
  baseDelayMs: number
  maxDelayMs: number
  backoffMultiplier: number
}

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
  // Retry policy configuration
  retry_strategy?: RetryStrategy
  retryStrategy?: RetryStrategy
  retry_max_attempts?: number
  retryMaxAttempts?: number
  retry_base_delay_ms?: number
  retryBaseDelayMs?: number
  retry_max_delay_ms?: number
  retryMaxDelayMs?: number
  retry_backoff_multiplier?: number
  retryBackoffMultiplier?: number
  retryPolicy?: RetryPolicy
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
  attemptNumber?: number
  started_at: string
  attemptedAt?: string
  status_code?: number | null // null on network error / timeout
  statusCode?: number | null
  latency_ms: number
  latencyMs?: number
  error?: string | null
  errorMessage?: string | null
  response_body?: string | null
  responseBody?: string | null
  response_headers?: Record<string, string> | null
  responseHeaders?: Record<string, string> | null
}

export interface DeliveryDiagnostics {
  category: string
  recommendation: string
}

export interface DeliveryLifecycle {
  scheduledAt?: string | null
  leaseUntil?: string | null
  createdAt?: string
  updatedAt?: string
  nextAttemptAt?: string | null
}

export interface DeliveryRequestInfo {
  url: string
  method: string
  timestamp?: string
  headers?: Record<string, string>
}

export interface DeliveryLogEntry {
  timestamp: string
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG'
  event: string
  message: string
  attemptNumber?: number
  attempt_no?: number
  statusCode?: number | null
  status_code?: number | null
  latencyMs?: number
  latency_ms?: number
}

export interface DeliveryAttemptsResponse {
  deliveryId: string
  totalAttempts: number
  attempts: DeliveryAttempt[]
}

export interface DeliveryLogsResponse {
  deliveryId: string
  state: string
  attemptCount: number
  diagnostics?: DeliveryDiagnostics
  logs: DeliveryLogEntry[]
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
  // Diagnostics & Enrichments
  diagnostics?: DeliveryDiagnostics
  retry?: RetryPolicy
  lifecycle?: DeliveryLifecycle
  request?: DeliveryRequestInfo
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

export interface RedisHealthInfo {
  status: 'up' | 'down' | 'disabled'
  latencyMs?: number
  error?: string
}

export interface HealthResponse {
  status: 'up' | 'down' | 'degraded'
  timestamp: string
  checks?: {
    database?: {
      status: 'up' | 'down'
      error?: string
    }
    redis?: RedisHealthInfo
  }
}

export interface CacheTelemetry {
  hits: number
  misses: number
  totalLookups: number
  hitRatio: number
  sets: number
  deletes: number
  keysCount?: number
  ttlConfig: {
    endpointTtlSeconds: number
    endpointsListTtlSeconds: number
    analyticsOverviewTtlSeconds: number
  }
}

export interface RateLimitPolicy {
  name: string
  type: 'tenant' | 'auth_fail' | 'health'
  limit: number
  windowMs: number
  unit: string
  description: string
  currentUsage?: number
}

export interface RateLimitTelemetry {
  allowedRequests: number
  throttledRequests: number
  totalEvaluated: number
  throttleRate: number
  policies: RateLimitPolicy[]
}

export interface RedisMonitoringOverview {
  health: RedisHealthInfo
  systemStatus: 'up' | 'down' | 'degraded'
  timestamp: string
  isFallbackActive: boolean
  fallbackReason?: string
  cache: CacheTelemetry
  rateLimiting: RateLimitTelemetry
  connectedClients?: number
  memoryUsedMb?: number
  mode: 'live' | 'demo'
}

export interface OverviewMetrics {
  totalEvents: number
  totalDeliveries: number
  succeededDeliveries: number
  failedDeliveries: number
  pendingDeliveries: number
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

// --- Webhook Templates ---

export interface WebhookTemplate {
  id: string
  tenant_id?: string | null
  tenantId?: string | null
  name: string
  description?: string | null
  http_method: string
  httpMethod: string
  url?: string | null
  custom_headers: Record<string, string>
  customHeaders: Record<string, string>
  default_payload?: unknown
  defaultPayload?: unknown
  rate_limit_rps: number
  rateLimitRps: number
  retry_strategy: RetryStrategy
  retryStrategy: RetryStrategy
  retry_max_attempts: number
  retryMaxAttempts: number
  retry_base_delay_ms: number
  retryBaseDelayMs: number
  retry_max_delay_ms: number
  retryMaxDelayMs: number
  retry_backoff_multiplier: number
  retryBackoffMultiplier: number
  retry_policy?: RetryPolicy
  retryPolicy?: RetryPolicy
  is_system: boolean
  isSystem: boolean
  created_at: string
  createdAt: string
  updated_at: string
  updatedAt: string
}

export interface CreateTemplateInput {
  name: string
  description?: string
  httpMethod?: string
  http_method?: string
  url?: string
  customHeaders?: Record<string, string>
  custom_headers?: Record<string, string>
  defaultPayload?: unknown
  default_payload?: unknown
  rateLimitRps?: number
  rate_limit_rps?: number
  retryStrategy?: RetryStrategy
  retry_strategy?: RetryStrategy
  retryMaxAttempts?: number
  retry_max_attempts?: number
  retryBaseDelayMs?: number
  retry_base_delay_ms?: number
  retryMaxDelayMs?: number
  retry_max_delay_ms?: number
  retryBackoffMultiplier?: number
  retry_backoff_multiplier?: number
  retryPolicy?: Partial<RetryPolicy>
  retry_policy?: Partial<RetryPolicy>
}

export interface UpdateTemplateInput {
  name?: string
  description?: string
  httpMethod?: string
  http_method?: string
  url?: string
  customHeaders?: Record<string, string>
  custom_headers?: Record<string, string>
  defaultPayload?: unknown
  default_payload?: unknown
  rateLimitRps?: number
  rate_limit_rps?: number
  retryStrategy?: RetryStrategy
  retry_strategy?: RetryStrategy
  retryMaxAttempts?: number
  retry_max_attempts?: number
  retryBaseDelayMs?: number
  retry_base_delay_ms?: number
  retryMaxDelayMs?: number
  retry_max_delay_ms?: number
  retryBackoffMultiplier?: number
  retry_backoff_multiplier?: number
  retryPolicy?: Partial<RetryPolicy>
  retry_policy?: Partial<RetryPolicy>
}

export interface TemplateApplyResult {
  templateId: string
  templateName: string
  url?: string | null
  httpMethod: string
  customHeaders: Record<string, string>
  defaultPayload?: unknown
  rateLimitRps: number
  retryStrategy: RetryStrategy
  retryMaxAttempts: number
  retryBaseDelayMs: number
  retryMaxDelayMs: number
  retryBackoffMultiplier: number
  retryPolicy?: RetryPolicy
}
