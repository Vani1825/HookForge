/**
 * Webhook Template domain model.
 * Immutable POJO representing a reusable webhook template.
 */

import { v4 as uuidv4 } from 'uuid';

export const SENSITIVE_HEADER_PATTERNS = Object.freeze([
  /^authorization$/i,
  /^proxy-authorization$/i,
  /^x-api-key$/i,
  /^api-key$/i,
  /^cookie$/i,
  /^set-cookie$/i,
  /^x-webhook-secret$/i,
  /^x-auth-token$/i,
  /^x-access-token$/i,
  /secret/i,
  /password/i,
  /token/i,
]);

/**
 * Sanitize headers by redacting sensitive values (API keys, authorization tokens, secrets)
 *
 * @param {Object} headers - Key-value headers object
 * @returns {Object} Sanitized copy of headers
 */
export function sanitizeHeaders(headers = {}) {
  if (!headers || typeof headers !== 'object') {
    return {};
  }
  const sanitized = {};
  for (const [key, value] of Object.entries(headers)) {
    const isSensitive = SENSITIVE_HEADER_PATTERNS.some((pattern) => pattern.test(key));
    if (isSensitive) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * Create a WebhookTemplate domain entity.
 *
 * @param {Object} data - Raw template attributes
 * @returns {Readonly<Object>} Immutable domain model
 */
export function createWebhookTemplate(data = {}) {
  const isSystem = Boolean(data.isSystem ?? data.is_system);
  const rawStrategy = data.retryStrategy ?? data.retry_strategy ?? 'EXPONENTIAL';
  const retryStrategy = String(rawStrategy).toUpperCase();

  const retryMaxAttempts =
    data.retryMaxAttempts !== undefined
      ? Number(data.retryMaxAttempts)
      : (data.retry_max_attempts !== undefined ? Number(data.retry_max_attempts) : 8);

  const retryBaseDelayMs =
    data.retryBaseDelayMs !== undefined
      ? Number(data.retryBaseDelayMs)
      : (data.retry_base_delay_ms !== undefined
          ? Number(data.retry_base_delay_ms)
          : (data.retryDelayMs !== undefined
              ? Number(data.retryDelayMs)
              : (data.retry_delay_ms !== undefined ? Number(data.retry_delay_ms) : 5000)));

  const retryMaxDelayMs =
    data.retryMaxDelayMs !== undefined
      ? Number(data.retryMaxDelayMs)
      : (data.retry_max_delay_ms !== undefined ? Number(data.retry_max_delay_ms) : 3600000);

  const retryBackoffMultiplier =
    data.retryBackoffMultiplier !== undefined
      ? Number(data.retryBackoffMultiplier)
      : (data.retry_backoff_multiplier !== undefined ? Number(data.retry_backoff_multiplier) : 2.0);

  let customHeaders = data.customHeaders ?? data.custom_headers ?? data.headers ?? {};
  if (typeof customHeaders === 'string') {
    try {
      customHeaders = JSON.parse(customHeaders);
    } catch {
      customHeaders = {};
    }
  }

  let defaultPayload = data.defaultPayload ?? data.default_payload ?? data.payload ?? null;
  if (typeof defaultPayload === 'string') {
    try {
      defaultPayload = JSON.parse(defaultPayload);
    } catch {
      // Keep payload as string if not valid JSON
    }
  }

  const template = {
    id: data.id || uuidv4(),
    tenantId: isSystem ? null : (data.tenantId ?? data.tenant_id ?? null),
    name: data.name,
    description: data.description || null,
    httpMethod: String(data.httpMethod ?? data.http_method ?? 'POST').toUpperCase(),
    url: data.url || null,
    customHeaders: typeof customHeaders === 'object' && customHeaders !== null ? customHeaders : {},
    defaultPayload,
    rateLimitRps:
      data.rateLimitRps !== undefined
        ? Number(data.rateLimitRps)
        : (data.rate_limit_rps !== undefined ? Number(data.rate_limit_rps) : 10),
    retryStrategy,
    retryMaxAttempts,
    retryBaseDelayMs,
    retryMaxDelayMs,
    retryBackoffMultiplier,
    isSystem,
    createdAt: data.createdAt ?? data.created_at ?? new Date().toISOString(),
    updatedAt: data.updatedAt ?? data.updated_at ?? new Date().toISOString(),
  };

  return Object.freeze(template);
}

/**
 * Convert template to response DTO (sanitizes sensitive headers)
 *
 * @param {Object} template - WebhookTemplate domain entity
 * @returns {Object} Response DTO with camelCase, snake_case, and nested retryPolicy
 */
export function toResponseDTO(template) {
  const retryStrategy = template.retryStrategy || 'EXPONENTIAL';
  const retryMaxAttempts = template.retryMaxAttempts !== undefined ? template.retryMaxAttempts : 8;
  const retryBaseDelayMs = template.retryBaseDelayMs !== undefined ? template.retryBaseDelayMs : 5000;
  const retryMaxDelayMs = template.retryMaxDelayMs !== undefined ? template.retryMaxDelayMs : 3600000;
  const retryBackoffMultiplier =
    template.retryBackoffMultiplier !== undefined ? template.retryBackoffMultiplier : 2.0;

  const sanitizedHeaders = sanitizeHeaders(template.customHeaders);

  return {
    id: template.id,
    tenantId: template.tenantId,
    tenant_id: template.tenantId,
    name: template.name,
    description: template.description,
    httpMethod: template.httpMethod,
    http_method: template.httpMethod,
    url: template.url,
    customHeaders: sanitizedHeaders,
    custom_headers: sanitizedHeaders,
    headers: sanitizedHeaders,
    defaultPayload: template.defaultPayload,
    default_payload: template.defaultPayload,
    payload: template.defaultPayload,
    rateLimitRps: template.rateLimitRps,
    rate_limit_rps: template.rateLimitRps,
    retryStrategy,
    retry_strategy: retryStrategy,
    retryMaxAttempts,
    retry_max_attempts: retryMaxAttempts,
    retryBaseDelayMs,
    retry_base_delay_ms: retryBaseDelayMs,
    retryMaxDelayMs,
    retry_max_delay_ms: retryMaxDelayMs,
    retryBackoffMultiplier,
    retry_backoff_multiplier: retryBackoffMultiplier,
    retryPolicy: {
      strategy: retryStrategy,
      maxAttempts: retryMaxAttempts,
      baseDelayMs: retryBaseDelayMs,
      maxDelayMs: retryMaxDelayMs,
      backoffMultiplier: retryBackoffMultiplier,
    },
    isSystem: template.isSystem,
    is_system: template.isSystem,
    createdAt: template.createdAt,
    created_at: template.createdAt,
    updatedAt: template.updatedAt,
    updated_at: template.updatedAt,
  };
}

export default {
  createWebhookTemplate,
  toResponseDTO,
  sanitizeHeaders,
  SENSITIVE_HEADER_PATTERNS,
};

