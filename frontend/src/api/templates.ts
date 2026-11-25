import { apiClient } from './client'
import { normalizeEndpoint } from './endpoints'
import type {
  WebhookTemplate,
  CreateTemplateInput,
  UpdateTemplateInput,
  TemplateApplyResult,
  Endpoint,
  RetryStrategy,
} from '../types'

export interface TemplateQueryParams {
  type?: 'all' | 'system' | 'custom'
  search?: string
}

export function normalizeTemplate(t: any): WebhookTemplate {
  if (!t || typeof t !== 'object') return t
  const isSystem = Boolean(t.is_system ?? t.isSystem)
  const strategy = (
    t.retry_strategy ||
    t.retryStrategy ||
    t.retryPolicy?.strategy ||
    'EXPONENTIAL'
  ).toUpperCase() as RetryStrategy

  const maxAttempts =
    t.retry_max_attempts ?? t.retryMaxAttempts ?? t.retryPolicy?.maxAttempts ?? 8

  const baseDelayMs =
    t.retry_base_delay_ms ??
    t.retryBaseDelayMs ??
    t.retry_delay_ms ??
    t.retryDelayMs ??
    t.retryPolicy?.baseDelayMs ??
    5000

  const maxDelayMs =
    t.retry_max_delay_ms ??
    t.retryMaxDelayMs ??
    t.retryPolicy?.maxDelayMs ??
    (strategy === 'FIXED' ? baseDelayMs : 3600000)

  const backoffMultiplier =
    t.retry_backoff_multiplier ??
    t.retryBackoffMultiplier ??
    t.retryPolicy?.backoffMultiplier ??
    (strategy === 'FIXED' ? 1.0 : 2.0)

  const headers = t.custom_headers ?? t.customHeaders ?? t.headers ?? {}
  const payload =
    t.default_payload !== undefined
      ? t.default_payload
      : t.defaultPayload !== undefined
      ? t.defaultPayload
      : t.payload

  const rateLimit = t.rate_limit_rps ?? t.rateLimitRps ?? 10
  const method = (t.http_method || t.httpMethod || 'POST').toUpperCase()

  const retryPolicy = {
    strategy,
    maxAttempts,
    baseDelayMs,
    maxDelayMs,
    backoffMultiplier,
  }

  return {
    id: t.id,
    tenant_id: t.tenant_id ?? t.tenantId ?? null,
    tenantId: t.tenantId ?? t.tenant_id ?? null,
    name: t.name || '',
    description: t.description || '',
    http_method: method,
    httpMethod: method,
    url: t.url || null,
    custom_headers: headers,
    customHeaders: headers,
    default_payload: payload,
    defaultPayload: payload,
    rate_limit_rps: rateLimit,
    rateLimitRps: rateLimit,
    retry_strategy: strategy,
    retryStrategy: strategy,
    retry_max_attempts: maxAttempts,
    retryMaxAttempts: maxAttempts,
    retry_base_delay_ms: baseDelayMs,
    retryBaseDelayMs: baseDelayMs,
    retry_max_delay_ms: maxDelayMs,
    retryMaxDelayMs: maxDelayMs,
    retry_backoff_multiplier: backoffMultiplier,
    retryBackoffMultiplier: backoffMultiplier,
    retry_policy: retryPolicy,
    retryPolicy,
    is_system: isSystem,
    isSystem: isSystem,
    created_at: t.created_at || t.createdAt || new Date().toISOString(),
    createdAt: t.createdAt || t.created_at || new Date().toISOString(),
    updated_at: t.updated_at || t.updatedAt || new Date().toISOString(),
    updatedAt: t.updatedAt || t.updated_at || new Date().toISOString(),
  }
}

/**
 * Fetch list of templates with optional type and search filters
 */
export async function fetchTemplates(
  filter?: TemplateQueryParams
): Promise<WebhookTemplate[]> {
  const params: Record<string, string | undefined> = {}
  if (filter?.type && filter.type !== 'all') {
    params.type = filter.type
  }
  if (filter?.search && filter.search.trim()) {
    params.search = filter.search.trim()
  }

  const raw = await apiClient.get<any[]>('/templates', { params })
  return (raw || []).map(normalizeTemplate)
}

/**
 * Fetch a specific template by ID
 */
export async function fetchTemplateById(id: string): Promise<WebhookTemplate> {
  const raw = await apiClient.get<any>(`/templates/${encodeURIComponent(id)}`)
  return normalizeTemplate(raw)
}

/**
 * Create a new user-owned webhook template
 */
export async function createTemplate(
  input: CreateTemplateInput
): Promise<WebhookTemplate> {
  const raw = await apiClient.post<any>('/templates', input)
  return normalizeTemplate(raw)
}

/**
 * Update an existing user-owned webhook template
 */
export async function updateTemplate(
  id: string,
  input: UpdateTemplateInput
): Promise<WebhookTemplate> {
  const raw = await apiClient.patch<any>(`/templates/${encodeURIComponent(id)}`, input)
  return normalizeTemplate(raw)
}

/**
 * Delete a user-owned webhook template
 */
export async function deleteTemplate(
  id: string
): Promise<{ success: boolean; id: string; message: string }> {
  return apiClient.delete<{ success: boolean; id: string; message: string }>(
    `/templates/${encodeURIComponent(id)}`
  )
}

/**
 * Prefill endpoint configuration from a template with optional overrides without creating
 */
export async function applyTemplate(
  id: string,
  overrides?: Record<string, unknown>
): Promise<TemplateApplyResult> {
  const raw = await apiClient.post<any>(
    `/templates/${encodeURIComponent(id)}/apply`,
    overrides || {}
  )

  const strategy = (
    raw.retryStrategy ||
    raw.retry_strategy ||
    raw.retryPolicy?.strategy ||
    'EXPONENTIAL'
  ).toUpperCase() as RetryStrategy

  const maxAttempts =
    raw.retryMaxAttempts ?? raw.retry_max_attempts ?? raw.retryPolicy?.maxAttempts ?? 8
  const baseDelayMs =
    raw.retryBaseDelayMs ??
    raw.retry_base_delay_ms ??
    raw.retryDelayMs ??
    raw.retryPolicy?.baseDelayMs ??
    5000
  const maxDelayMs =
    raw.retryMaxDelayMs ?? raw.retry_max_delay_ms ?? raw.retryPolicy?.maxDelayMs ?? 3600000
  const backoffMultiplier =
    raw.retryBackoffMultiplier ??
    raw.retry_backoff_multiplier ??
    raw.retryPolicy?.backoffMultiplier ??
    2.0

  return {
    templateId: raw.templateId || raw.template_id || id,
    templateName: raw.templateName || raw.template_name || '',
    url: raw.url || null,
    httpMethod: (raw.httpMethod || raw.http_method || 'POST').toUpperCase(),
    customHeaders: raw.customHeaders || raw.custom_headers || raw.headers || {},
    defaultPayload:
      raw.defaultPayload !== undefined ? raw.defaultPayload : raw.default_payload,
    rateLimitRps: raw.rateLimitRps ?? raw.rate_limit_rps ?? 10,
    retryStrategy: strategy,
    retryMaxAttempts: maxAttempts,
    retryBaseDelayMs: baseDelayMs,
    retryMaxDelayMs: maxDelayMs,
    retryBackoffMultiplier: backoffMultiplier,
    retryPolicy: {
      strategy,
      maxAttempts,
      baseDelayMs,
      maxDelayMs,
      backoffMultiplier,
    },
  }
}

/**
 * Explicitly create an endpoint from template
 */
export async function createEndpointFromTemplate(
  id: string,
  overrides?: Record<string, unknown>
): Promise<Endpoint> {
  const raw = await apiClient.post<any>(
    `/templates/${encodeURIComponent(id)}/create-endpoint`,
    overrides || {}
  )
  return normalizeEndpoint(raw)
}

