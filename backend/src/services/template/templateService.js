/**
 * TemplateService - Business logic for webhook templates.
 * Manages template CRUD, ownership enforcement, validation, and template application.
 */

import templateRepository from '../../repositories/jdbc/templateRepository.js';
import {
  createWebhookTemplate,
  toResponseDTO,
  sanitizeHeaders,
} from '../../domain/models/webhookTemplate.js';
import {
  ValidationError,
  NotFoundError,
  ForbiddenError,
} from '../../middleware/errorHandler.js';
import config from '../../config/index.js';
import logger from '../../utils/logger.js';

const ALLOWED_HTTP_METHODS = Object.freeze(['POST', 'PUT', 'PATCH', 'GET', 'DELETE']);

/**
 * Validate header key-value dictionary for security and RFC HTTP compliance.
 * Disallows CRLF injection and non-string header names.
 *
 * @param {Object} headers - Dictionary of headers
 */
function validateCustomHeaders(headers) {
  if (headers === null || headers === undefined) {
    return;
  }
  if (typeof headers !== 'object' || Array.isArray(headers)) {
    throw new ValidationError('customHeaders must be a valid key-value object');
  }

  const validHeaderKeyRegex = /^[a-zA-Z0-9!#$%&'*+\-.^_`|~]+$/;

  for (const [key, value] of Object.entries(headers)) {
    if (typeof key !== 'string' || !validHeaderKeyRegex.test(key)) {
      throw new ValidationError(`Invalid header name: '${key}' contains illegal characters`);
    }
    const strVal = String(value);
    if (/[\r\n]/.test(strVal)) {
      throw new ValidationError(`Header value for '${key}' contains illegal newline characters`);
    }
    if (strVal.length > 8192) {
      throw new ValidationError(`Header value for '${key}' exceeds 8KB limit`);
    }
  }
}

/**
 * Validate payload object or string and check payload size limits.
 *
 * @param {Object|string} payload - Payload to validate
 */
function validateDefaultPayload(payload) {
  if (payload === null || payload === undefined) {
    return;
  }
  let jsonString;
  if (typeof payload === 'string') {
    jsonString = payload;
  } else if (typeof payload === 'object') {
    try {
      jsonString = JSON.stringify(payload);
    } catch {
      throw new ValidationError('defaultPayload must be valid serializable JSON');
    }
  } else {
    throw new ValidationError('defaultPayload must be an object, array, or JSON string');
  }

  const payloadBytes = Buffer.byteLength(jsonString, 'utf8');
  const maxBytes = config.ingest?.maxPayloadBytes || 1048576; // 1MB default
  if (payloadBytes > maxBytes) {
    throw new ValidationError(
      `defaultPayload size (${payloadBytes} bytes) exceeds maximum allowed size (${maxBytes} bytes)`
    );
  }
}

/**
 * Extract and validate retry settings from template request.
 *
 * @param {Object} request - Inbound request body
 * @param {Object|null} [existing=null] - Existing template (for updates)
 * @returns {Object} Normalized retry settings
 */
function extractAndValidateRetrySettings(request, existing = null) {
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

  const settings = {};

  if (rawStrategy !== undefined) {
    const s = String(rawStrategy).trim().toUpperCase();
    if (s !== 'EXPONENTIAL' && s !== 'FIXED') {
      throw new ValidationError(`retryStrategy must be 'EXPONENTIAL' or 'FIXED'`);
    }
    settings.retryStrategy = s;
  } else if (existing) {
    settings.retryStrategy = existing.retryStrategy || 'EXPONENTIAL';
  } else {
    settings.retryStrategy = 'EXPONENTIAL';
  }

  if (rawMaxAttempts !== undefined) {
    const num = Number(rawMaxAttempts);
    if (!Number.isInteger(num) || num < 1 || num > 50) {
      throw new ValidationError('retryMaxAttempts must be an integer between 1 and 50');
    }
    settings.retryMaxAttempts = num;
  } else if (existing) {
    settings.retryMaxAttempts = existing.retryMaxAttempts ?? 8;
  } else {
    settings.retryMaxAttempts = 8;
  }

  if (rawBaseDelayMs !== undefined) {
    const num = Number(rawBaseDelayMs);
    if (!Number.isInteger(num) || num < 100 || num > 86400000) {
      throw new ValidationError('retryBaseDelayMs must be an integer between 100 and 86400000');
    }
    settings.retryBaseDelayMs = num;
  } else if (existing) {
    settings.retryBaseDelayMs = existing.retryBaseDelayMs ?? 5000;
  } else {
    settings.retryBaseDelayMs = 5000;
  }

  if (rawMaxDelayMs !== undefined) {
    const num = Number(rawMaxDelayMs);
    if (!Number.isInteger(num) || num < 100 || num > 86400000) {
      throw new ValidationError('retryMaxDelayMs must be an integer between 100 and 86400000');
    }
    settings.retryMaxDelayMs = num;
  } else if (existing) {
    settings.retryMaxDelayMs = existing.retryMaxDelayMs ?? 3600000;
  } else {
    settings.retryMaxDelayMs = 3600000;
  }

  if (rawBackoffMultiplier !== undefined) {
    const num = Number(rawBackoffMultiplier);
    if (Number.isNaN(num) || num < 1.0 || num > 10.0) {
      throw new ValidationError('retryBackoffMultiplier must be a number between 1.0 and 10.0');
    }
    settings.retryBackoffMultiplier = num;
  } else if (existing) {
    settings.retryBackoffMultiplier = existing.retryBackoffMultiplier ?? 2.0;
  } else {
    settings.retryBackoffMultiplier = 2.0;
  }

  // Cross-field validation: maxDelayMs must be >= baseDelayMs
  if (settings.retryMaxDelayMs < settings.retryBaseDelayMs) {
    throw new ValidationError('retryMaxDelayMs must be greater than or equal to retryBaseDelayMs');
  }

  return settings;
}

/**
 * Validate destination URL if provided.
 *
 * @param {string} url - Destination URL
 */
function validateTemplateUrl(url) {
  if (!url || typeof url !== 'string' || !url.trim()) {
    return;
  }
  const trimmed = url.trim();
  // Allow template URLs containing placeholder keywords like PLACEHOLDER or {{...}}
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new ValidationError('URL must use http:// or https:// protocol');
    }
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    throw new ValidationError('URL must be a valid, well-formed URL');
  }
}

/**
 * Create a new user template for an authenticated tenant.
 *
 * @param {string} tenantId - Authenticated tenant UUID
 * @param {Object} request - Template creation payload
 * @returns {Promise<Object>} Created template response DTO
 */
export async function create(tenantId, request) {
  if (!tenantId) {
    throw new ValidationError('tenantId is required');
  }

  const name = request.name ? String(request.name).trim() : '';
  if (!name) {
    throw new ValidationError('Template name is required');
  }
  if (name.length > 100) {
    throw new ValidationError('Template name must not exceed 100 characters');
  }

  const description =
    request.description !== undefined && request.description !== null
      ? String(request.description).trim()
      : null;

  const rawMethod = request.httpMethod ?? request.http_method ?? 'POST';
  const httpMethod = String(rawMethod).trim().toUpperCase();
  if (!ALLOWED_HTTP_METHODS.includes(httpMethod)) {
    throw new ValidationError(
      `httpMethod must be one of: ${ALLOWED_HTTP_METHODS.join(', ')}`
    );
  }

  const url = request.url && typeof request.url === 'string' ? request.url.trim() : null;
  if (url) {
    validateTemplateUrl(url);
  }

  const customHeaders =
    request.customHeaders ?? request.custom_headers ?? request.headers ?? {};
  validateCustomHeaders(customHeaders);

  const defaultPayload =
    request.defaultPayload !== undefined
      ? request.defaultPayload
      : (request.default_payload !== undefined ? request.default_payload : request.payload);
  validateDefaultPayload(defaultPayload);

  let rateLimitRps = 10;
  const rawRps = request.rateLimitRps ?? request.rate_limit_rps;
  if (rawRps !== undefined) {
    const num = Number(rawRps);
    if (!Number.isInteger(num) || num < 1 || num > 500) {
      throw new ValidationError('rateLimitRps must be an integer between 1 and 500');
    }
    rateLimitRps = num;
  }

  const retrySettings = extractAndValidateRetrySettings(request);

  // User templates are never system templates
  const template = createWebhookTemplate({
    tenantId,
    name,
    description,
    httpMethod,
    url,
    customHeaders,
    defaultPayload,
    rateLimitRps,
    ...retrySettings,
    isSystem: false,
  });

  const inserted = await templateRepository.insert(template);

  logger.info('Webhook template created', {
    templateId: inserted.id,
    tenantId,
    name: inserted.name,
  });

  return toResponseDTO(inserted);
}

/**
 * List all available templates for an authenticated tenant.
 * Includes predefined system templates and the tenant's own custom templates.
 *
 * @param {string} tenantId - Authenticated tenant UUID
 * @param {Object} [filter={}] - Filter options (type: 'system'|'custom', search: string)
 * @returns {Promise<Array>} List of template response DTOs
 */
export async function list(tenantId, filter = {}) {
  let templates = await templateRepository.findAllByTenant(tenantId, filter);

  if (filter.type === 'system') {
    templates = templates.filter((t) => t.isSystem);
  } else if (filter.type === 'custom' || filter.type === 'user') {
    templates = templates.filter((t) => !t.isSystem);
  }

  if (filter.search && typeof filter.search === 'string' && filter.search.trim()) {
    const q = filter.search.trim().toLowerCase();
    templates = templates.filter(
      (t) =>
        (t.name && t.name.toLowerCase().includes(q)) ||
        (t.description && t.description.toLowerCase().includes(q))
    );
  }

  return templates.map(toResponseDTO);
}

/**
 * Get a specific template by ID.
 * Returns the template if it belongs to the tenant or is a predefined system template.
 *
 * @param {string} tenantId - Authenticated tenant UUID
 * @param {string} templateId - Template UUID
 * @returns {Promise<Object>} Template response DTO
 */
export async function getById(tenantId, templateId) {
  const template = await templateRepository.findByIdAndTenant(templateId, tenantId);
  if (!template) {
    throw new NotFoundError('Template not found');
  }
  return toResponseDTO(template);
}

/**
 * Update an existing template owned by the tenant.
 * System templates and templates belonging to other tenants cannot be modified.
 *
 * @param {string} tenantId - Authenticated tenant UUID
 * @param {string} templateId - Template UUID
 * @param {Object} request - Updates payload
 * @returns {Promise<Object>} Updated template response DTO
 */
export async function update(tenantId, templateId, request) {
  // First verify existence and ownership
  const existing = await templateRepository.findByIdAndTenant(templateId, tenantId);
  if (!existing) {
    throw new NotFoundError('Template not found');
  }

  // System templates cannot be modified
  if (existing.isSystem) {
    throw new ForbiddenError('System templates cannot be modified');
  }

  const updates = {};

  if (request.name !== undefined) {
    const name = String(request.name).trim();
    if (!name) {
      throw new ValidationError('Template name cannot be empty');
    }
    if (name.length > 100) {
      throw new ValidationError('Template name must not exceed 100 characters');
    }
    updates.name = name;
  }

  if (request.description !== undefined) {
    updates.description =
      request.description !== null ? String(request.description).trim() : null;
  }

  if (request.httpMethod !== undefined || request.http_method !== undefined) {
    const rawMethod = request.httpMethod ?? request.http_method;
    const method = String(rawMethod).trim().toUpperCase();
    if (!ALLOWED_HTTP_METHODS.includes(method)) {
      throw new ValidationError(
        `httpMethod must be one of: ${ALLOWED_HTTP_METHODS.join(', ')}`
      );
    }
    updates.httpMethod = method;
  }

  if (request.url !== undefined) {
    const url = request.url !== null ? String(request.url).trim() : null;
    if (url) {
      validateTemplateUrl(url);
    }
    updates.url = url;
  }

  if (
    request.customHeaders !== undefined ||
    request.custom_headers !== undefined ||
    request.headers !== undefined
  ) {
    const headers =
      request.customHeaders ?? request.custom_headers ?? request.headers ?? {};
    validateCustomHeaders(headers);
    updates.customHeaders = headers;
  }

  if (
    request.defaultPayload !== undefined ||
    request.default_payload !== undefined ||
    request.payload !== undefined
  ) {
    const payload =
      request.defaultPayload !== undefined
        ? request.defaultPayload
        : (request.default_payload !== undefined ? request.default_payload : request.payload);
    validateDefaultPayload(payload);
    updates.defaultPayload = payload;
  }

  if (request.rateLimitRps !== undefined || request.rate_limit_rps !== undefined) {
    const rawRps = request.rateLimitRps ?? request.rate_limit_rps;
    const num = Number(rawRps);
    if (!Number.isInteger(num) || num < 1 || num > 500) {
      throw new ValidationError('rateLimitRps must be an integer between 1 and 500');
    }
    updates.rateLimitRps = num;
  }

  // Handle retry settings updates
  const hasRetryFields =
    request.retryStrategy !== undefined ||
    request.retry_strategy !== undefined ||
    request.retryMaxAttempts !== undefined ||
    request.retry_max_attempts !== undefined ||
    request.retryBaseDelayMs !== undefined ||
    request.retry_base_delay_ms !== undefined ||
    request.retryDelayMs !== undefined ||
    request.retry_delay_ms !== undefined ||
    request.retryMaxDelayMs !== undefined ||
    request.retry_max_delay_ms !== undefined ||
    request.retryBackoffMultiplier !== undefined ||
    request.retry_backoff_multiplier !== undefined ||
    request.retryPolicy !== undefined ||
    request.retry_policy !== undefined;

  if (hasRetryFields) {
    const retrySettings = extractAndValidateRetrySettings(request, existing);
    Object.assign(updates, retrySettings);
  }

  const updated = await templateRepository.update(templateId, tenantId, updates);
  if (!updated) {
    throw new NotFoundError('Template not found or update failed');
  }

  logger.info('Webhook template updated', {
    templateId,
    tenantId,
    name: updated.name,
  });

  return toResponseDTO(updated);
}

/**
 * Delete a template owned by the tenant.
 * System templates and templates belonging to other tenants cannot be deleted.
 *
 * @param {string} tenantId - Authenticated tenant UUID
 * @param {string} templateId - Template UUID
 * @returns {Promise<Object>} Deletion confirmation object
 */
export async function remove(tenantId, templateId) {
  // First verify existence and ownership
  const existing = await templateRepository.findByIdAndTenant(templateId, tenantId);
  if (!existing) {
    throw new NotFoundError('Template not found');
  }

  // System templates cannot be deleted
  if (existing.isSystem) {
    throw new ForbiddenError('System templates cannot be deleted');
  }

  const deleted = await templateRepository.deleteByIdAndTenant(templateId, tenantId);
  if (!deleted) {
    throw new NotFoundError('Template not found');
  }

  logger.info('Webhook template deleted', { templateId, tenantId });

  return { success: true, id: templateId, message: 'Template deleted successfully' };
}

/**
 * Apply a template to prefill endpoint configuration with optional user overrides.
 * DOES NOT create an endpoint in the database unless explicitly requested.
 *
 * @param {string} tenantId - Authenticated tenant UUID
 * @param {string} templateId - Template UUID
 * @param {Object} [overrides={}] - Optional user-specified overrides
 * @returns {Promise<Object>} Resolved prefilled endpoint configuration DTO
 */
export async function applyTemplate(tenantId, templateId, overrides = {}) {
  const template = await templateRepository.findByIdAndTenant(templateId, tenantId);
  if (!template) {
    throw new NotFoundError('Template not found');
  }

  const nestedRetry = overrides.retryPolicy || overrides.retry_policy || {};

  const effectiveUrl = overrides.url && typeof overrides.url === 'string' && overrides.url.trim()
    ? overrides.url.trim()
    : template.url;

  const effectiveMethod = (
    overrides.httpMethod ||
    overrides.http_method ||
    template.httpMethod ||
    'POST'
  ).toUpperCase();

  const overrideHeaders =
    overrides.customHeaders || overrides.custom_headers || overrides.headers || {};
  const mergedHeaders = { ...template.customHeaders, ...overrideHeaders };

  const effectivePayload =
    overrides.defaultPayload !== undefined
      ? overrides.defaultPayload
      : (overrides.default_payload !== undefined
          ? overrides.default_payload
          : (overrides.payload !== undefined ? overrides.payload : template.defaultPayload));

  let effectiveRateLimitRps = template.rateLimitRps;
  const rawRps = overrides.rateLimitRps ?? overrides.rate_limit_rps;
  if (rawRps !== undefined) {
    const num = Number(rawRps);
    if (!Number.isInteger(num) || num < 1 || num > 500) {
      throw new ValidationError('rateLimitRps must be an integer between 1 and 500');
    }
    effectiveRateLimitRps = num;
  }

  const rawStrategy =
    overrides.retryStrategy ??
    overrides.retry_strategy ??
    nestedRetry.strategy ??
    nestedRetry.retryStrategy ??
    template.retryStrategy;
  const effectiveStrategy = String(rawStrategy).toUpperCase();
  if (effectiveStrategy !== 'EXPONENTIAL' && effectiveStrategy !== 'FIXED') {
    throw new ValidationError(`retryStrategy must be 'EXPONENTIAL' or 'FIXED'`);
  }

  const rawAttempts =
    overrides.retryMaxAttempts ??
    overrides.retry_max_attempts ??
    nestedRetry.maxAttempts ??
    nestedRetry.retryMaxAttempts ??
    template.retryMaxAttempts;
  const effectiveMaxAttempts = Number(rawAttempts);
  if (!Number.isInteger(effectiveMaxAttempts) || effectiveMaxAttempts < 1 || effectiveMaxAttempts > 50) {
    throw new ValidationError('retryMaxAttempts must be an integer between 1 and 50');
  }

  const rawBaseDelay =
    overrides.retryBaseDelayMs ??
    overrides.retry_base_delay_ms ??
    overrides.retryDelayMs ??
    overrides.retry_delay_ms ??
    nestedRetry.baseDelayMs ??
    nestedRetry.retryBaseDelayMs ??
    nestedRetry.delayMs ??
    nestedRetry.retryDelayMs ??
    template.retryBaseDelayMs;
  const effectiveBaseDelayMs = Number(rawBaseDelay);
  if (!Number.isInteger(effectiveBaseDelayMs) || effectiveBaseDelayMs < 100 || effectiveBaseDelayMs > 86400000) {
    throw new ValidationError('retryBaseDelayMs must be an integer between 100 and 86400000');
  }

  const rawMaxDelay =
    overrides.retryMaxDelayMs ??
    overrides.retry_max_delay_ms ??
    nestedRetry.maxDelayMs ??
    nestedRetry.retryMaxDelayMs ??
    template.retryMaxDelayMs;
  const effectiveMaxDelayMs = Number(rawMaxDelay);
  if (!Number.isInteger(effectiveMaxDelayMs) || effectiveMaxDelayMs < 100 || effectiveMaxDelayMs > 86400000) {
    throw new ValidationError('retryMaxDelayMs must be an integer between 100 and 86400000');
  }

  const rawMultiplier =
    overrides.retryBackoffMultiplier ??
    overrides.retry_backoff_multiplier ??
    nestedRetry.backoffMultiplier ??
    nestedRetry.retryBackoffMultiplier ??
    nestedRetry.multiplier ??
    template.retryBackoffMultiplier;
  const effectiveBackoffMultiplier = Number(rawMultiplier);
  if (Number.isNaN(effectiveBackoffMultiplier) || effectiveBackoffMultiplier < 1.0 || effectiveBackoffMultiplier > 10.0) {
    throw new ValidationError('retryBackoffMultiplier must be a number between 1.0 and 10.0');
  }

  if (effectiveMaxDelayMs < effectiveBaseDelayMs) {
    throw new ValidationError('retryMaxDelayMs must be greater than or equal to retryBaseDelayMs');
  }

  const sanitizedHeaders = sanitizeHeaders(mergedHeaders);

  return {
    templateId: template.id,
    template_id: template.id,
    templateName: template.name,
    template_name: template.name,
    url: effectiveUrl,
    httpMethod: effectiveMethod,
    http_method: effectiveMethod,
    customHeaders: sanitizedHeaders,
    custom_headers: sanitizedHeaders,
    headers: sanitizedHeaders,
    defaultPayload: effectivePayload,
    default_payload: effectivePayload,
    payload: effectivePayload,
    rateLimitRps: effectiveRateLimitRps,
    rate_limit_rps: effectiveRateLimitRps,
    retryStrategy: effectiveStrategy,
    retry_strategy: effectiveStrategy,
    retryMaxAttempts: effectiveMaxAttempts,
    retry_max_attempts: effectiveMaxAttempts,
    retryBaseDelayMs: effectiveBaseDelayMs,
    retry_base_delay_ms: effectiveBaseDelayMs,
    retryMaxDelayMs: effectiveMaxDelayMs,
    retry_max_delay_ms: effectiveMaxDelayMs,
    retryBackoffMultiplier: effectiveBackoffMultiplier,
    retry_backoff_multiplier: effectiveBackoffMultiplier,
    retryPolicy: {
      strategy: effectiveStrategy,
      maxAttempts: effectiveMaxAttempts,
      baseDelayMs: effectiveBaseDelayMs,
      maxDelayMs: effectiveMaxDelayMs,
      backoffMultiplier: effectiveBackoffMultiplier,
    },
  };
}

/**
 * Explicitly create an endpoint from a template with optional user overrides.
 *
 * @param {string} tenantId - Authenticated tenant UUID
 * @param {string} templateId - Template UUID
 * @param {Object} [overrides={}] - Optional user-specified overrides
 * @returns {Promise<Object>} Created endpoint with one-time HMAC secret
 */
export async function createEndpointFromTemplate(tenantId, templateId, overrides = {}) {
  const prefilled = await applyTemplate(tenantId, templateId, overrides);

  if (!prefilled.url) {
    throw new ValidationError('Destination URL is required to create an endpoint from template');
  }

  // Dynamically import endpointService to prevent circular dependency
  const { default: endpointService } = await import('../endpoint/endpointService.js');

  const endpoint = await endpointService.create(tenantId, {
    ...prefilled,
    url: prefilled.url,
    rateLimitRps: prefilled.rateLimitRps,
  });

  return endpoint;
}

export default {
  create,
  list,
  getById,
  update,
  remove,
  applyTemplate,
  createEndpointFromTemplate,
};

