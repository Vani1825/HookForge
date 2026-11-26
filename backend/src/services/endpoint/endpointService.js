/**
 * EndpointService - Business logic for endpoint management.
 * Handles endpoint CRUD operations with tenant isolation.
 */

import crypto from 'crypto';
import endpointRepository from '../../repositories/jdbc/endpointRepository.js';
import { toResponseDTO } from '../../domain/models/endpoint.js';
import { validateUrl, sanitizeUrlForLogging } from '../../utils/ssrf.js';
import { sign } from '../delivery/hmacSha256Signer.js';
import httpWebhookSender from '../delivery/httpWebhookSender.js';
import { ValidationError, NotFoundError } from '../../middleware/errorHandler.js';
import config from '../../config/index.js';
import logger from '../../utils/logger.js';
import cacheService from '../cache/cacheService.js';

/**
 * Generate a webhook signing secret.
 * 32 random bytes, Base64 URL-safe, "whsec_" prefix.
 * Matches reference's generateSecret() method.
 *
 * @returns {string} Generated secret
 */
function generateSecret() {
  const bytes = crypto.randomBytes(32);
  const base64 = bytes.toString('base64');
  // Make URL-safe by replacing + with - and / with _
  const urlSafe = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `whsec_${urlSafe}`;
}

/**
 * Extract and validate custom retry settings from request.
 * Supports flat camelCase, snake_case, and nested retryPolicy / retry_policy objects.
 *
 * @param {Object} request - Inbound request body
 * @param {Object|null} [existing=null] - Existing endpoint (for updates)
 * @returns {Object|null} Normalized retry settings or null if none provided
 */
function extractAndValidateRetrySettings(request, existing = null) {
  if (!request || typeof request !== 'object') {
    return null;
  }

  const nested = request.retryPolicy || request.retry_policy || {};

  const rawStrategy =
    request.retryStrategy ??
    request.retry_strategy ??
    nested.strategy ??
    nested.retryStrategy;

  const rawMaxAttempts =
    request.retryMaxAttempts ??
    request.retry_max_attempts ??
    nested.maxAttempts ??
    nested.retryMaxAttempts;

  const rawBaseDelayMs =
    request.retryBaseDelayMs ??
    request.retry_base_delay_ms ??
    request.retryDelayMs ??
    request.retry_delay_ms ??
    nested.baseDelayMs ??
    nested.retryBaseDelayMs ??
    nested.delayMs ??
    nested.retryDelayMs;

  const rawMaxDelayMs =
    request.retryMaxDelayMs ??
    request.retry_max_delay_ms ??
    nested.maxDelayMs ??
    nested.retryMaxDelayMs;

  const rawBackoffMultiplier =
    request.retryBackoffMultiplier ??
    request.retry_backoff_multiplier ??
    nested.backoffMultiplier ??
    nested.retryBackoffMultiplier ??
    nested.multiplier;

  const hasAnyRetryField =
    rawStrategy !== undefined ||
    rawMaxAttempts !== undefined ||
    rawBaseDelayMs !== undefined ||
    rawMaxDelayMs !== undefined ||
    rawBackoffMultiplier !== undefined;

  if (!hasAnyRetryField && !existing) {
    return null;
  }

  const settings = {};

  if (rawStrategy !== undefined) {
    const s = String(rawStrategy).trim().toUpperCase();
    if (s !== 'EXPONENTIAL' && s !== 'FIXED') {
      throw new ValidationError(`retryStrategy must be 'EXPONENTIAL' or 'FIXED'`);
    }
    settings.retryStrategy = s;
  } else if (existing) {
    settings.retryStrategy = existing.retryStrategy || 'EXPONENTIAL';
  }

  if (rawMaxAttempts !== undefined) {
    const num = Number(rawMaxAttempts);
    if (!Number.isInteger(num) || num < 1 || num > 50) {
      throw new ValidationError('retryMaxAttempts must be an integer between 1 and 50');
    }
    settings.retryMaxAttempts = num;
  } else if (existing) {
    settings.retryMaxAttempts = existing.retryMaxAttempts ?? 8;
  }

  if (rawBaseDelayMs !== undefined) {
    const num = Number(rawBaseDelayMs);
    if (!Number.isInteger(num) || num < 100 || num > 86400000) {
      throw new ValidationError('retryBaseDelayMs must be an integer between 100 and 86400000');
    }
    settings.retryBaseDelayMs = num;
  } else if (existing) {
    settings.retryBaseDelayMs = existing.retryBaseDelayMs ?? 5000;
  }

  if (rawMaxDelayMs !== undefined) {
    const num = Number(rawMaxDelayMs);
    if (!Number.isInteger(num) || num < 100 || num > 86400000) {
      throw new ValidationError('retryMaxDelayMs must be an integer between 100 and 86400000');
    }
    settings.retryMaxDelayMs = num;
  } else if (existing) {
    settings.retryMaxDelayMs = existing.retryMaxDelayMs ?? 3600000;
  }

  if (rawBackoffMultiplier !== undefined) {
    const num = Number(rawBackoffMultiplier);
    if (Number.isNaN(num) || num < 1.0 || num > 10.0) {
      throw new ValidationError('retryBackoffMultiplier must be a number between 1.0 and 10.0');
    }
    settings.retryBackoffMultiplier = num;
  } else if (existing) {
    settings.retryBackoffMultiplier = existing.retryBackoffMultiplier ?? 2.0;
  }

  // Cross-field validation: maxDelayMs must be >= baseDelayMs
  const effectiveBase = settings.retryBaseDelayMs ?? existing?.retryBaseDelayMs ?? 5000;
  const effectiveMax = settings.retryMaxDelayMs ?? existing?.retryMaxDelayMs ?? 3600000;
  if (effectiveMax < effectiveBase) {
    throw new ValidationError('retryMaxDelayMs must be greater than or equal to retryBaseDelayMs');
  }

  return settings;
}

/**
 * Create a new endpoint for a tenant.
 *
 * @param {string} tenantId - Tenant UUID
 * @param {Object} request - Create endpoint request
 * @param {string} request.url - Webhook URL
 * @param {number} request.rateLimitRps - Rate limit in requests per second (optional, defaults to 10)
 * @returns {Promise<Object>} Created endpoint with secret (shown only once)
 */
export async function create(tenantId, request) {
  let effectiveRequest = { ...request };
  const templateId = request.templateId || request.template_id;
  if (templateId) {
    const { default: templateService } = await import('../template/templateService.js');
    const prefilled = await templateService.applyTemplate(tenantId, templateId, request);
    effectiveRequest = {
      ...prefilled,
      ...request,
      url: request.url || prefilled.url,
      rateLimitRps:
        request.rateLimitRps !== undefined
          ? request.rateLimitRps
          : (request.rate_limit_rps !== undefined ? request.rate_limit_rps : prefilled.rateLimitRps),
    };
  }

  const { url, rateLimitRps = 10 } = effectiveRequest;
  if (!url) {
    throw new ValidationError('URL is required');
  }

  // SSRF protection: validate protocol, port, host literals, and resolved DNS
  await validateUrl(url);

  const retrySettings = extractAndValidateRetrySettings(effectiveRequest);

  const secret = generateSecret();

  const endpoint = retrySettings
    ? await endpointRepository.insert(
        tenantId,
        url,
        secret,
        rateLimitRps,
        retrySettings
      )
    : await endpointRepository.insert(
        tenantId,
        url,
        secret,
        rateLimitRps
      );

  logger.info('Endpoint created', {
    endpointId: endpoint.id,
    tenantId,
    url,
    retryStrategy: endpoint.retryStrategy,
  });

  // Invalidate tenant endpoints list cache
  await cacheService.del(`tenant:${tenantId}:endpoints:list`);

  // Return endpoint with secret (shown only on create)
  return endpoint;
}

/**
 * List all endpoints for a tenant.
 *
 * @param {string} tenantId - Tenant UUID
 * @returns {Promise<Array>} Array of endpoint DTOs (without secret)
 */
export async function list(tenantId) {
  const cacheKey = `tenant:${tenantId}:endpoints:list`;
  const cached = await cacheService.get(cacheKey);
  if (cached) {
    return cached;
  }

  const endpoints = await endpointRepository.findAllByTenant(tenantId);
  const dtos = endpoints.map(toResponseDTO);
  const ttl = config.redis?.cacheTtlSeconds?.endpointsList || 300;
  await cacheService.set(cacheKey, dtos, ttl);
  return dtos;
}

/**
 * Get an endpoint by ID for a tenant.
 *
 * @param {string} tenantId - Tenant UUID
 * @param {string} endpointId - Endpoint UUID
 * @returns {Promise<Object|null>} Endpoint DTO (without secret) or null if not found
 */
export async function getById(tenantId, endpointId) {
  const cacheKey = `tenant:${tenantId}:endpoint:${endpointId}`;
  const cached = await cacheService.get(cacheKey);
  if (cached) {
    return cached;
  }

  const endpoint = await endpointRepository.findByIdAndTenant(
    endpointId,
    tenantId
  );

  if (!endpoint) {
    logger.warn('Endpoint not found or access denied', {
      endpointId,
      tenantId,
    });
    return null;
  }

  const dto = toResponseDTO(endpoint);
  const ttl = config.redis?.cacheTtlSeconds?.endpoint || 300;
  await cacheService.set(cacheKey, dto, ttl);
  return dto;
}

/**
 * Update an endpoint.
 *
 * @param {string} tenantId - Tenant UUID
 * @param {string} endpointId - Endpoint UUID
 * @param {Object} request - Update endpoint request
 * @param {string} request.url - New webhook URL (optional)
 * @param {boolean} request.active - Active status (optional)
 * @param {number} request.rateLimitRps - New rate limit (optional)
 * @returns {Promise<Object|null>} Updated endpoint DTO (without secret) or null if not found
 */
export async function update(tenantId, endpointId, request) {
  // First, find the endpoint to validate ownership
  const existing = await endpointRepository.findByIdAndTenant(
    endpointId,
    tenantId
  );

  if (!existing) {
    logger.warn('Endpoint not found or access denied', {
      endpointId,
      tenantId,
    });
    return null;
  }

  // SSRF protection on URL update
  if (request.url !== undefined) {
    await validateUrl(request.url);
  }

  const retrySettings = extractAndValidateRetrySettings(request, existing);

  // Patch fields (only update provided fields)
  const updates = {
    id: existing.id,
    tenantId: existing.tenantId,
    url: request.url !== undefined ? request.url : existing.url,
    secret: existing.secret, // Secret never changes via update
    active: request.active !== undefined ? request.active : existing.active,
    rateLimitRps:
      request.rateLimitRps !== undefined
        ? request.rateLimitRps
        : existing.rateLimitRps,
    circuitState: existing.circuitState,
    circuitUntil: existing.circuitUntil,
    consecutiveFailures: existing.consecutiveFailures,
    retryStrategy: retrySettings?.retryStrategy ?? existing.retryStrategy ?? 'EXPONENTIAL',
    retryMaxAttempts: retrySettings?.retryMaxAttempts ?? existing.retryMaxAttempts ?? 8,
    retryBaseDelayMs: retrySettings?.retryBaseDelayMs ?? existing.retryBaseDelayMs ?? 5000,
    retryMaxDelayMs: retrySettings?.retryMaxDelayMs ?? existing.retryMaxDelayMs ?? 3600000,
    retryBackoffMultiplier: retrySettings?.retryBackoffMultiplier ?? existing.retryBackoffMultiplier ?? 2.0,
  };

  const updated = await endpointRepository.update(updates);

  logger.info('Endpoint updated', {
    endpointId,
    tenantId,
  });

  // Invalidate caches
  await Promise.all([
    cacheService.del(`tenant:${tenantId}:endpoint:${endpointId}`),
    cacheService.del(`tenant:${tenantId}:endpoints:list`),
  ]);

  // Return DTO without secret
  return toResponseDTO(updated);
}

/**
 * Retrieve a single endpoint for a tenant.
 *
 * @param {string} tenantId - Tenant UUID
 * @param {string} endpointId - Endpoint UUID
 * @returns {Promise<Object|null>} Endpoint DTO (without secret) or null if not found
 */
export async function get(tenantId, endpointId) {
  return getById(tenantId, endpointId);
}

/**
 * Deactivate/delete an endpoint for a tenant.
 *
 * @param {string} tenantId - Tenant UUID
 * @param {string} endpointId - Endpoint UUID
 * @returns {Promise<Object|null>} Result object or null if not found
 */
export async function remove(tenantId, endpointId) {
  const existing = await endpointRepository.findByIdAndTenant(endpointId, tenantId);
  if (!existing) {
    return null;
  }
  await endpointRepository.deactivate(endpointId);
  await Promise.all([
    cacheService.del(`tenant:${tenantId}:endpoint:${endpointId}`),
    cacheService.del(`tenant:${tenantId}:endpoints:list`),
  ]);
  return { success: true, id: endpointId, active: false };
}

/**
 * Sensitive request headers to redact from diagnostics output summary.
 */
const REDACTED_HEADERS = new Set([
  'authorization',
  'x-api-key',
  'api-key',
  'proxy-authorization',
]);

/**
 * Allowed HTTP methods for endpoint testing.
 */
const ALLOWED_TEST_METHODS = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
]);

/**
 * Test an endpoint destination without creating production webhook delivery records.
 * Supports testing saved endpoints by ID (with tenant authorization) or ad-hoc URLs.
 *
 * @param {string} tenantId - Authenticated tenant UUID
 * @param {Object} options - Test configuration options
 * @param {string} [options.endpointId] - Optional endpoint UUID
 * @param {string} [options.id] - Optional endpoint UUID alias
 * @param {string} [options.endpoint_id] - Optional endpoint UUID alias
 * @param {string} [options.url] - Optional target URL (overrides or provides ad-hoc URL)
 * @param {string} [options.method] - HTTP method (GET, POST, PUT, PATCH, DELETE, HEAD) - default POST
 * @param {Object} [options.headers] - Custom request headers map
 * @param {Object|string} [options.payload] - Custom JSON request payload
 * @param {Object|string} [options.body] - Custom JSON request body alias
 * @param {string} [options.secret] - Optional signing secret override for HMAC-SHA256
 * @param {number} [options.timeoutMs] - Test timeout in milliseconds (500ms - 30000ms)
 * @param {number} [options.timeout_ms] - Test timeout alias
 * @param {boolean} [options.allowLocal] - Allowed for local development/test harness
 * @returns {Promise<Object>} Structured test outcome
 */
export async function testEndpoint(tenantId, options = {}) {
  // 1. Resolve endpoint & destination URL
  const endpointId = options.endpointId || options.id || options.endpoint_id;
  let endpoint = null;

  if (endpointId) {
    endpoint = await endpointRepository.findByIdAndTenant(endpointId, tenantId);
    if (!endpoint) {
      logger.warn('Endpoint not found for testing or access denied', {
        endpointId,
        tenantId,
      });
      throw new NotFoundError('Endpoint not found');
    }
  }

  const targetUrl = options.url || endpoint?.url;
  if (!targetUrl || typeof targetUrl !== 'string' || !targetUrl.trim()) {
    throw new ValidationError('Either a valid endpoint ID or a target URL must be provided');
  }

  const signingSecret = options.secret || endpoint?.secret || null;

  // 2. Validate HTTP method
  const rawMethod = options.method || 'POST';
  if (typeof rawMethod !== 'string') {
    throw new ValidationError('Method must be a string');
  }
  const method = rawMethod.trim().toUpperCase();
  if (!ALLOWED_TEST_METHODS.has(method)) {
    throw new ValidationError(
      `Invalid HTTP method '${rawMethod}'. Allowed methods: ${Array.from(ALLOWED_TEST_METHODS).join(', ')}`
    );
  }

  // 3. Validate URL format and SSRF upfront
  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl.trim());
  } catch {
    throw new ValidationError('Target URL must be a valid HTTP or HTTPS URL');
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new ValidationError(
      `Unsupported URL protocol '${parsedUrl.protocol}'. Only HTTP and HTTPS are supported.`
    );
  }

  const allowLocal =
    options.allowLocal !== undefined
      ? Boolean(options.allowLocal)
      : Boolean(config?.ssrf?.allowLocal);

  try {
    await validateUrl(targetUrl.trim(), { allowLocal });
  } catch (ssrfErr) {
    throw new ValidationError(`SSRF validation failed: ${ssrfErr.message}`);
  }

  // 4. Validate custom request headers
  const customHeaders = options.headers || {};
  if (typeof customHeaders !== 'object' || Array.isArray(customHeaders) || customHeaders === null) {
    throw new ValidationError('Headers must be a key-value object');
  }

  const requestHeaders = {};
  for (const [key, val] of Object.entries(customHeaders)) {
    if (typeof key !== 'string' || typeof val !== 'string') {
      throw new ValidationError('Header keys and values must be strings');
    }
    // Prevent CRLF injection / HTTP request smuggling
    if (/[\r\n]/.test(key) || /[\r\n]/.test(val)) {
      throw new ValidationError('Header names and values must not contain newline characters');
    }
    const lowerKey = key.toLowerCase();
    if (lowerKey === 'host') {
      // Ignore custom Host header; Host is controlled by URL resolution
      continue;
    }
    requestHeaders[key] = val;
  }

  // 5. Prepare request payload
  const isGetOrHead = method === 'GET' || method === 'HEAD';
  let payloadString = null;
  let payloadSummary = null;

  if (!isGetOrHead) {
    const rawPayload = options.payload !== undefined ? options.payload : options.body;
    if (rawPayload !== undefined && rawPayload !== null) {
      payloadSummary = rawPayload;
      payloadString =
        typeof rawPayload === 'string'
          ? rawPayload
          : JSON.stringify(rawPayload);
    } else {
      const defaultPayload = {
        event: 'endpoint.test',
        timestamp: new Date().toISOString(),
        message: 'HookForge webhook endpoint test payload',
        data: {
          test: true,
          endpointId: endpoint?.id || null,
          tenantId,
        },
      };
      payloadSummary = defaultPayload;
      payloadString = JSON.stringify(defaultPayload);
    }

    // Guard maximum request payload size (1 MB limit)
    if (Buffer.byteLength(payloadString, 'utf8') > 1048576) {
      throw new ValidationError('Request payload exceeds maximum allowed size of 1MB');
    }

    if (!requestHeaders['Content-Type'] && !requestHeaders['content-type']) {
      requestHeaders['Content-Type'] = 'application/json';
    }
  }

  // 6. Generate HMAC signature and webhook diagnostic headers
  const timestamp = Math.floor(Date.now() / 1000);
  const testId = `test_${crypto.randomUUID()}`;

  requestHeaders['X-Webhook-Id'] = testId;
  requestHeaders['X-Webhook-Timestamp'] = timestamp.toString();
  requestHeaders['X-HookForge-Test'] = 'true';

  if (signingSecret) {
    const signature = sign(signingSecret, payloadString ?? '', timestamp);
    requestHeaders['X-Webhook-Signature'] = signature;
  }

  // 7. Request timeout bounds
  const defaultTimeout = config?.http?.readTimeoutMs ?? 10000;
  const requestedTimeout = options.timeoutMs ?? options.timeout_ms ?? defaultTimeout;
  const timeoutMs = Math.min(Math.max(Number(requestedTimeout) || defaultTimeout, 500), 30000);

  // 8. Dispatch stateless test request via SSRF-safe connection-pinned sender
  const senderResult = await httpWebhookSender.test(
    targetUrl.trim(),
    payloadString,
    requestHeaders,
    timeoutMs,
    {
      method,
      allowLocal,
      dnsLookup: options.dnsLookup,
      maxResponseBytes: options.maxResponseBytes,
      maxCaptureBytes: options.maxCaptureBytes ?? 65536,
    }
  );

  // 9. Sanitize request headers for response output
  const sanitizedRequestHeaders = {};
  for (const [k, v] of Object.entries(requestHeaders)) {
    if (REDACTED_HEADERS.has(k.toLowerCase())) {
      sanitizedRequestHeaders[k] = '[REDACTED]';
    } else {
      sanitizedRequestHeaders[k] = v;
    }
  }

  // 10. Format structured response
  const isSuccess = Boolean(
    senderResult.statusCode &&
    senderResult.statusCode >= 200 &&
    senderResult.statusCode < 300
  );
  const testedAt = new Date().toISOString();

  const responseData =
    senderResult.statusCode !== null
      ? {
          statusCode: senderResult.statusCode,
          status_code: senderResult.statusCode,
          headers: senderResult.headers || {},
          body: senderResult.body ?? null,
          sizeBytes:
            senderResult.sizeBytes ??
            (senderResult.body ? Buffer.byteLength(senderResult.body, 'utf8') : 0),
          size_bytes:
            senderResult.sizeBytes ??
            (senderResult.body ? Buffer.byteLength(senderResult.body, 'utf8') : 0),
          truncated: senderResult.truncated ?? false,
        }
      : null;

  logger.info('Endpoint tested', {
    tenantId,
    endpointId: endpoint?.id || null,
    url: sanitizeUrlForLogging(targetUrl.trim()),
    method,
    statusCode: senderResult.statusCode,
    latencyMs: senderResult.latencyMs,
    success: isSuccess,
  });

  return {
    success: isSuccess,
    statusCode: senderResult.statusCode,
    status_code: senderResult.statusCode,
    latencyMs: senderResult.latencyMs ?? 0,
    latency_ms: senderResult.latencyMs ?? 0,
    error: senderResult.error || null,
    request: {
      url: targetUrl.trim(),
      method,
      headers: sanitizedRequestHeaders,
      payload: payloadSummary,
    },
    response: responseData,
    testedAt,
    tested_at: testedAt,
  };
}

export default {
  create,
  list,
  getById,
  update,
  get,
  remove,
  testEndpoint,
};
