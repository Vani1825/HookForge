/**
 * FixedDelayRetryPolicy - Retry policy with fixed delay interval.
 * Returns a constant delay for retryable outcomes until max attempts are exhausted.
 */

import { deliveryOutcome } from '../../domain/deliveryOutcome.js';

const DEFAULT_FIXED_DELAY_MS = 5000;
const DEFAULT_MAX_ATTEMPTS = 8;
const RETRY_LIMITED_MAX_ATTEMPTS = 3;

/**
 * Create a FixedDelayRetryPolicy instance with custom parameters.
 * @param {Object} [options={}] - Configuration options
 * @param {number} [options.delayMs=5000] - Fixed delay in milliseconds
 * @param {number} [options.maxAttempts=8] - Maximum retry attempts
 * @returns {Object} Configured fixed delay retry policy
 */
export function createFixedDelayRetryPolicy(options = {}) {
  const maxAttempts =
    options.maxAttempts ??
    options.retryMaxAttempts ??
    options.retry_max_attempts ??
    DEFAULT_MAX_ATTEMPTS;

  const delayMs =
    options.delayMs ??
    options.retryBaseDelayMs ??
    options.retry_base_delay_ms ??
    options.retryDelayMs ??
    options.retry_delay_ms ??
    DEFAULT_FIXED_DELAY_MS;

  const retryLimitedMaxAttempts = Math.min(RETRY_LIMITED_MAX_ATTEMPTS, maxAttempts);

  return {
    strategy: 'FIXED',
    maxAttempts,
    delayMs,

    /**
     * Calculate next retry delay.
     * @param {number} attemptCount - Current attempt count (1-indexed)
     * @param {Object|string} outcome - Delivery outcome
     * @returns {Promise<number|null>} Delay in milliseconds, or null if no more retries
     */
    async nextDelay(attemptCount, outcome) {
      const outcomeStr = outcome?.toString() || outcome;

      // Non-retryable outcomes
      if (
        outcome === deliveryOutcome.SUCCESS ||
        outcomeStr === 'SUCCESS' ||
        outcome === deliveryOutcome.ENDPOINT_GONE ||
        outcomeStr === 'ENDPOINT_GONE'
      ) {
        return null;
      }

      // Determine max attempts based on outcome
      const effectiveMax =
        outcome === deliveryOutcome.RETRY_LIMITED || outcomeStr === 'RETRY_LIMITED'
          ? retryLimitedMaxAttempts
          : maxAttempts;

      // No more retries if limit reached or exceeded
      if (attemptCount >= effectiveMax) {
        return null;
      }

      return delayMs;
    },
  };
}

// Default instance using system defaults
export const defaultFixedDelayRetryPolicy = createFixedDelayRetryPolicy();

export default {
  createFixedDelayRetryPolicy,
  nextDelay: (attemptCount, outcome) => defaultFixedDelayRetryPolicy.nextDelay(attemptCount, outcome),
};

