/**
 * Redaction and sanitization utilities for safe logging and API responses.
 * Ensures credentials, tokens, sensitive payload keys, and infrastructure details
 * are never exposed.
 */

const SENSITIVE_KEY_PATTERN =
  /^(password|secret|token|api_?key|auth|authorization|private_?key|credential|client_?secret|access_?token|refresh_?token|id_?token|ssh_?key|certificate|cvv|ssn|card|credit_?card|card_?number|signing_?secret|webhook_?secret)$/i;

const SENSITIVE_SUBSTRING_PATTERN =
  /(password|secret|token|api_?key|auth|credential|private_?key|bearer)/i;

/**
 * Check if a key name represents a sensitive credential or secret.
 * @param {string} key
 * @returns {boolean}
 */
export function isSensitiveKey(key) {
  if (!key || typeof key !== 'string') return false;
  return SENSITIVE_KEY_PATTERN.test(key) || SENSITIVE_SUBSTRING_PATTERN.test(key);
}

/**
 * Recursively redact sensitive keys from an object or array.
 * Bounds recursion depth and string lengths to avoid memory spikes.
 *
 * @param {*} data - Raw data to redact
 * @param {number} [maxDepth=8] - Maximum recursion depth
 * @param {number} [maxStringLen=2048] - Maximum string length per field
 * @returns {*} Redacted and bounded clone
 */
export function redactSensitiveData(data, maxDepth = 8, maxStringLen = 2048) {
  return _redactRecursive(data, 0, maxDepth, maxStringLen);
}

function _redactRecursive(value, depth, maxDepth, maxStringLen) {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    if (value.length > maxStringLen) {
      return value.slice(0, maxStringLen) + '... [TRUNCATED]';
    }
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (depth > maxDepth) {
    return '[NESTED_OBJECT_TRUNCATED]';
  }

  if (Array.isArray(value)) {
    // Bound array length to at most 100 items in logs/summaries
    const boundedArray = value.slice(0, 100);
    const result = boundedArray.map((item) =>
      _redactRecursive(item, depth + 1, maxDepth, maxStringLen)
    );
    if (value.length > 100) {
      result.push(`... [${value.length - 100} MORE ITEMS TRUNCATED]`);
    }
    return result;
  }

  if (typeof value === 'object') {
    const result = {};
    for (const [k, v] of Object.entries(value)) {
      if (isSensitiveKey(k)) {
        if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
          result[k] = _redactRecursive(v, depth + 1, maxDepth, maxStringLen);
        } else {
          result[k] = '[REDACTED]';
        }
      } else {
        result[k] = _redactRecursive(v, depth + 1, maxDepth, maxStringLen);
      }
    }
    return result;
  }

  return String(value);
}

/**
 * Sanitize error message to prevent leaking tokens, passwords, database URLs,
 * internal stack traces, or internal server IPs.
 *
 * @param {string} rawError - Raw error string
 * @param {number} [maxLen=1024] - Maximum error message length
 * @returns {string|null} Sanitized error message
 */
export function sanitizeErrorMessage(rawError, maxLen = 1024) {
  if (!rawError || typeof rawError !== 'string') {
    return null;
  }

  let error = rawError.trim();

  // Strip Node.js stack traces
  const stackIndex = error.indexOf('\n    at ');
  if (stackIndex !== -1) {
    error = error.slice(0, stackIndex).trim();
  }

  // Redact Bearer / Basic tokens
  error = error.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]');
  error = error.replace(/Basic\s+[A-Za-z0-9._~+/-]+=*/gi, 'Basic [REDACTED]');

  // Redact database connection strings (e.g. postgres://user:password@host:port/db)
  error = error.replace(
    /postgres(?:ql)?:\/\/[^:]+:[^@]+@[^/]+/gi,
    'postgres://[REDACTED]@[REDACTED]'
  );

  // Redact query parameter credentials (e.g. ?token=..., &key=..., ?secret=...)
  error = error.replace(
    /([?&](?:key|api_?key|token|access_?token|secret|password|auth|sig|signature)=)[^&]+/gi,
    '$1[REDACTED]'
  );

  // Redact private IP addresses in error text if leaking internal topologies
  error = error.replace(
    /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g,
    '[PRIVATE_IP]'
  );

  // Bound length
  if (error.length > maxLen) {
    error = error.slice(0, maxLen) + '... [TRUNCATED]';
  }

  return error;
}

/**
 * Sanitize target URL: redact query parameter keys that look like secrets/tokens.
 *
 * @param {string} rawUrl
 * @returns {string} Sanitized URL
 */
export function sanitizeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  try {
    const parsed = new URL(rawUrl);
    for (const [key] of parsed.searchParams.entries()) {
      if (isSensitiveKey(key)) {
        parsed.searchParams.set(key, '[REDACTED]');
      }
    }
    return parsed.toString();
  } catch {
    // If not a standard URL, perform regex replacement on query parameters
    return rawUrl.replace(
      /([?&](?:key|api_?key|token|access_?token|secret|password|auth|sig|signature)=)[^&]+/gi,
      '$1[REDACTED]'
    );
  }
}

/**
 * Classify a webhook delivery failure into a standard diagnostic category.
 *
 * @param {string|null} error
 * @param {number|null} statusCode
 * @returns {string} One of 'SUCCESS', 'TIMEOUT', 'NETWORK_ERROR', 'BLOCKED_SSRF', 'RATE_LIMITED_429', 'CLIENT_ERROR_4XX', 'SERVER_ERROR_5XX', 'UNKNOWN'
 */
export function classifyFailure(error, statusCode) {
  if (statusCode && statusCode >= 200 && statusCode <= 299) {
    return 'SUCCESS';
  }

  if (statusCode === 429) {
    return 'RATE_LIMITED_429';
  }

  if (statusCode && statusCode >= 400 && statusCode <= 499) {
    return 'CLIENT_ERROR_4XX';
  }

  if (statusCode && statusCode >= 500 && statusCode <= 599) {
    return 'SERVER_ERROR_5XX';
  }

  const errStr = (error || '').toLowerCase();
  if (errStr.includes('ssrf') || errStr.includes('blocked') || errStr.includes('loopback')) {
    return 'BLOCKED_SSRF';
  }

  if (errStr.includes('timeout') || errStr.includes('econnaborted') || errStr.includes('etimedout')) {
    return 'TIMEOUT';
  }

  if (
    errStr.includes('econnrefused') ||
    errStr.includes('enotfound') ||
    errStr.includes('dns') ||
    errStr.includes('getaddrinfo')
  ) {
    return 'NETWORK_ERROR';
  }

  return 'UNKNOWN';
}

/**
 * Provide action-oriented resolution advice for a classified failure.
 *
 * @param {string} category
 * @param {number|null} statusCode
 * @returns {string} Recommended action
 */
export function getFailureRecommendation(category, statusCode) {
  switch (category) {
    case 'SUCCESS':
      return 'Delivery completed successfully with HTTP ' + statusCode + '.';
    case 'RATE_LIMITED_429':
      return 'Target endpoint is rate-limiting webhook dispatches. Lower the endpoint RPS rate limit or configure longer backoff.';
    case 'CLIENT_ERROR_4XX':
      return `Target endpoint returned HTTP ${statusCode}. Check the endpoint URL path, HTTP method, authentication headers, or request payload schema.`;
    case 'SERVER_ERROR_5XX':
      return `Target server returned HTTP ${statusCode}. The destination server encountered an internal error. Retries will execute per endpoint retry policy.`;
    case 'TIMEOUT':
      return 'The target server took too long to acknowledge the webhook. Verify server load, network latency, or increase the read timeout.';
    case 'NETWORK_ERROR':
      return 'Failed to reach the target server. Verify DNS records, firewall settings, and that the endpoint host is online.';
    case 'BLOCKED_SSRF':
      return 'Webhook delivery was blocked by SSRF protection. Destination resolves to a restricted private, cloud metadata, or loopback IP range.';
    default:
      return 'Inspect the attempt history and error details for additional diagnostic information.';
  }
}

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'x-webhook-signature',
  'x-api-key',
  'api-key',
  'x-auth-token',
  'cookie',
  'set-cookie',
]);

/**
 * Sanitize HTTP headers to prevent leaking signatures, auth tokens, or cookies.
 * @param {Object} headers
 * @returns {Object}
 */
export function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== 'object') return {};
  const sanitized = {};
  for (const [k, v] of Object.entries(headers)) {
    const lowerKey = k.toLowerCase();
    if (SENSITIVE_HEADERS.has(lowerKey) || isSensitiveKey(k)) {
      sanitized[k] = '[REDACTED]';
    } else {
      sanitized[k] = v;
    }
  }
  return sanitized;
}

/**
 * Sanitize response body content. Truncates oversized bodies to maxLen (default 65536)
 * and redacts sensitive payload fields if JSON.
 * @param {string} body
 * @param {number} [maxLen=65536]
 * @returns {string|null}
 */
export function sanitizeResponseBody(body, maxLen = 65536) {
  if (!body || typeof body !== 'string') return body ?? null;
  const trimmed = body.trim();
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      const parsed = JSON.parse(trimmed);
      const redacted = redactSensitiveData(parsed);
      return JSON.stringify(redacted);
    } catch {
      // not valid JSON, treat as text
    }
  }
  return sanitizeErrorMessage(body, maxLen) || (body.length > maxLen ? body.slice(0, maxLen) + '... [TRUNCATED]' : body);
}

export default {
  isSensitiveKey,
  redactSensitiveData,
  sanitizeErrorMessage,
  sanitizeUrl,
  classifyFailure,
  getFailureRecommendation,
  sanitizeHeaders,
  sanitizeResponseBody,
};
