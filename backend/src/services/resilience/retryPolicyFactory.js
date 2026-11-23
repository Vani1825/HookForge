/**
 * RetryPolicyFactory - Resolves appropriate retry policy for an endpoint.
 * Supports EXPONENTIAL (with full jitter) and FIXED strategies with custom limits.
 */

import { createFixedDelayRetryPolicy } from './fixedDelayRetryPolicy.js';
import exponentialJitterRetryPolicy, {
  createExponentialJitterRetryPolicy,
  defaultPolicy as defaultExponentialPolicy,
} from './exponentialJitterRetryPolicy.js';

/**
 * Resolve the appropriate retry policy for an endpoint based on its configuration.
 * Falls back to system default exponential jitter retry policy when no custom policy exists.
 *
 * @param {Object|null} endpoint - Endpoint domain model or row
 * @returns {Object} RetryPolicy instance implementing `nextDelay(attemptCount, outcome)`
 */
export function resolveRetryPolicy(endpoint) {
  if (!endpoint) {
    return exponentialJitterRetryPolicy;
  }

  const rawStrategy = endpoint.retryStrategy ?? endpoint.retry_strategy;
  const strategy = (rawStrategy || '').toUpperCase();

  if (strategy === 'FIXED') {
    return createFixedDelayRetryPolicy({
      maxAttempts: endpoint.retryMaxAttempts ?? endpoint.retry_max_attempts,
      delayMs:
        endpoint.retryBaseDelayMs ??
        endpoint.retry_base_delay_ms ??
        endpoint.retryDelayMs ??
        endpoint.retry_delay_ms,
    });
  }

  // Check if endpoint defines custom exponential parameters
  const hasCustomSettings =
    (endpoint.retryStrategy !== undefined && endpoint.retryStrategy !== null) ||
    (endpoint.retry_strategy !== undefined && endpoint.retry_strategy !== null) ||
    (endpoint.retryMaxAttempts !== undefined && endpoint.retryMaxAttempts !== null) ||
    (endpoint.retry_max_attempts !== undefined && endpoint.retry_max_attempts !== null) ||
    (endpoint.retryBaseDelayMs !== undefined && endpoint.retryBaseDelayMs !== null) ||
    (endpoint.retry_base_delay_ms !== undefined && endpoint.retry_base_delay_ms !== null) ||
    (endpoint.retryMaxDelayMs !== undefined && endpoint.retryMaxDelayMs !== null) ||
    (endpoint.retry_max_delay_ms !== undefined && endpoint.retry_max_delay_ms !== null) ||
    (endpoint.retryBackoffMultiplier !== undefined && endpoint.retryBackoffMultiplier !== null) ||
    (endpoint.retry_backoff_multiplier !== undefined && endpoint.retry_backoff_multiplier !== null);

  if (hasCustomSettings && (strategy === 'EXPONENTIAL' || !strategy)) {
    return createExponentialJitterRetryPolicy({
      maxAttempts: endpoint.retryMaxAttempts ?? endpoint.retry_max_attempts,
      baseDelayMs: endpoint.retryBaseDelayMs ?? endpoint.retry_base_delay_ms,
      maxDelayMs: endpoint.retryMaxDelayMs ?? endpoint.retry_max_delay_ms,
      multiplier: endpoint.retryBackoffMultiplier ?? endpoint.retry_backoff_multiplier,
    });
  }

  // Fallback to default singleton (preserving vi.mock support for existing tests)
  return exponentialJitterRetryPolicy || defaultExponentialPolicy;
}

export default {
  resolveRetryPolicy,
  createFixedDelayRetryPolicy,
  createExponentialJitterRetryPolicy,
};

