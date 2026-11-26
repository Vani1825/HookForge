/**
 * Configuration validation and safety boundaries for HookForge Benchmarking.
 */

import { sanitizeHeaders } from '../src/utils/redaction.js';

export const SAFE_LOCAL_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '0.0.0.0',
]);

export const DEFAULT_BENCHMARK_CONFIG = {
  baseUrl: 'http://127.0.0.1:8081',
  path: '/health',
  method: 'GET',
  requests: 50,
  concurrency: 5,
  timeoutMs: 5000,
  headers: {},
  allowRemote: false,
};

export const CONCURRENCY_PRESETS = {
  low: { concurrency: 1, requests: 20 },
  medium: { concurrency: 5, requests: 50 },
  high: { concurrency: 15, requests: 100 },
};

/**
 * Validate and normalize benchmark execution options.
 * Enforces security constraints to prevent accidental external benchmarking or DoS.
 *
 * @param {Object} options
 * @returns {Object} Normalized validated configuration
 */
export function validateBenchmarkConfig(options = {}) {
  const merged = { ...DEFAULT_BENCHMARK_CONFIG, ...options };

  // 1. URL validation and safety check
  let fullUrl;
  try {
    const base = merged.baseUrl.endsWith('/') ? merged.baseUrl.slice(0, -1) : merged.baseUrl;
    const path = merged.path.startsWith('/') ? merged.path : `/${merged.path}`;
    fullUrl = new URL(path, base);
  } catch (err) {
    throw new Error(`Invalid benchmark URL configuration: ${err.message}`);
  }

  const hostname = fullUrl.hostname.toLowerCase();
  if (!SAFE_LOCAL_HOSTNAMES.has(hostname) && !merged.allowRemote) {
    throw new Error(
      `Security Constraint: Target host "${hostname}" is not localhost. Benchmarking external or remote targets requires explicit { allowRemote: true }.`
    );
  }

  // 2. HTTP method validation
  const method = String(merged.method || 'GET').toUpperCase();
  const allowedMethods = ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH'];
  if (!allowedMethods.includes(method)) {
    throw new Error(`Unsupported HTTP method "${method}". Allowed methods: ${allowedMethods.join(', ')}`);
  }

  // 3. Request count and concurrency bounds
  const requests = Number(merged.requests);
  if (!Number.isInteger(requests) || requests <= 0 || requests > 5000) {
    throw new Error('Requests must be a positive integer between 1 and 5000.');
  }

  const concurrency = Number(merged.concurrency);
  if (!Number.isInteger(concurrency) || concurrency <= 0 || concurrency > 100) {
    throw new Error('Concurrency must be a positive integer between 1 and 100.');
  }

  if (concurrency > requests) {
    // Clamp concurrency to request count
    merged.concurrency = requests;
  }

  // 4. Timeout bounds
  const timeoutMs = Number(merged.timeoutMs);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000) {
    throw new Error('Timeout must be an integer between 100ms and 60000ms.');
  }

  // 5. Header normalization and safety
  const normalizedHeaders = {};
  if (merged.headers && typeof merged.headers === 'object') {
    for (const [k, v] of Object.entries(merged.headers)) {
      if (typeof v === 'string' || typeof v === 'number') {
        normalizedHeaders[k.toLowerCase()] = String(v);
      }
    }
  }

  return {
    url: fullUrl.toString(),
    baseUrl: `${fullUrl.protocol}//${fullUrl.host}`,
    path: `${fullUrl.pathname}${fullUrl.search}`,
    method,
    requests,
    concurrency: merged.concurrency,
    timeoutMs,
    headers: normalizedHeaders,
    body: merged.body,
    allowRemote: Boolean(merged.allowRemote),
  };
}

/**
 * Filter and redact sensitive keys from benchmark headers for safe reporting.
 *
 * @param {Object} headers
 * @returns {Object} Redacted headers
 */
export function sanitizeReportHeaders(headers = {}) {
  return sanitizeHeaders(headers);
}

export default {
  SAFE_LOCAL_HOSTNAMES,
  DEFAULT_BENCHMARK_CONFIG,
  CONCURRENCY_PRESETS,
  validateBenchmarkConfig,
  sanitizeReportHeaders,
};
