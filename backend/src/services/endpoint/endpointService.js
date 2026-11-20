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
 * Create a new endpoint for a tenant.
 *
 * @param {string} tenantId - Tenant UUID
 * @param {Object} request - Create endpoint request
 * @param {string} request.url - Webhook URL
 * @param {number} request.rateLimitRps - Rate limit in requests per second (optional, defaults to 10)
 * @returns {Promise<Object>} Created endpoint with secret (shown only once)
 */
export async function create(tenantId, request) {
  const { url, rateLimitRps = 10 } = request;

  // SSRF protection: validate protocol, port, host literals, and resolved DNS
  await validateUrl(url);

  const secret = generateSecret();

  const endpoint = await endpointRepository.insert(
    tenantId,
    url,
    secret,
    rateLimitRps
  );

  logger.info('Endpoint created', {
    endpointId: endpoint.id,
    tenantId,
    url,
  });

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
  const endpoints = await endpointRepository.findAllByTenant(tenantId);

  // Convert to response DTOs (exclude secret)
  return endpoints.map(toResponseDTO);
}

/**
 * Get an endpoint by ID for a tenant.
 *
 * @param {string} tenantId - Tenant UUID
 * @param {string} endpointId - Endpoint UUID
 * @returns {Promise<Object|null>} Endpoint DTO (without secret) or null if not found
 */
export async function getById(tenantId, endpointId) {
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

  return toResponseDTO(endpoint);
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
  };

  const updated = await endpointRepository.update(updates);

  logger.info('Endpoint updated', {
    endpointId,
    tenantId,
  });

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
  const endpoint = await endpointRepository.findByIdAndTenant(endpointId, tenantId);
  if (!endpoint) {
    return null;
  }
  return toResponseDTO(endpoint);
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

  try {
    await validateUrl(targetUrl.trim(), { allowLocal: options.allowLocal });
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
      allowLocal: options.allowLocal,
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
