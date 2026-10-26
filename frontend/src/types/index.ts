/**
 * HookForge Domain and API Types
 * Modeled directly on the PostgreSQL schema (migrations/V1__init.sql)
 * and backend domain models.
 */

export type DeliveryState = 'PENDING' | 'IN_FLIGHT' | 'RETRYING' | 'SUCCEEDED' | 'DEAD'

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
  endpoint?: Endpoint
  event?: WebhookEvent
  attempts?: DeliveryAttempt[]
  last_status_code?: number | null
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

export interface HealthResponse {
  status: 'up' | 'down'
  timestamp: string
  checks?: {
    database?: {
      status: 'up' | 'down'
      error?: string
    }
  }
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
