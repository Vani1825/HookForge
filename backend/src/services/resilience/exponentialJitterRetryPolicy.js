/**
 * ExponentialJitterRetryPolicy - Retry policy with exponential backoff and full jitter.
 * Formula: delay = random(0, min(cap, base * multiplier^(attempts-1)))
 */

import { deliveryOutcome } from '../../domain/deliveryOutcome.js';
import randomGenerator from '../../utils/random.js';
import config from '../../config/index.js';

const SYSTEM_BASE_DELAY_MS = config?.retry?.baseDelayMs ?? 5000;
const SYSTEM_MAX_DELAY_MS = config?.retry?.maxDelayMs ?? 3600000;
const SYSTEM_MAX_ATTEMPTS = config?.retry?.maxAttempts ?? 8;
const RETRY_LIMITED_MAX_ATTEMPTS = 3;

/**
 * Factory to create an ExponentialJitterRetryPolicy with custom parameters.
 * @param {Object} [options={}] - Configuration options
 * @param {number} [options.baseDelayMs] - Base delay in milliseconds
 * @param {number} [options.maxDelayMs] - Maximum delay cap in milliseconds
 * @param {number} [options.maxAttempts] - Maximum retry attempts
 * @param {number} [options.multiplier=2.0] - Backoff multiplier
 * @returns {Object} Configured exponential retry policy
 */
export function createExponentialJitterRetryPolicy(options = {}) {
  const baseDelayMs =
    options.baseDelayMs ??
    options.retryBaseDelayMs ??
    options.retry_base_delay_ms ??
    options.retryDelayMs ??
    options.retry_delay_ms ??
    SYSTEM_BASE_DELAY_MS;

  const maxDelayMs =
    options.maxDelayMs ??
    options.retryMaxDelayMs ??
    options.retry_max_delay_ms ??
    SYSTEM_MAX_DELAY_MS;

  const maxAttempts =
    options.maxAttempts ??
    options.retryMaxAttempts ??
    options.retry_max_attempts ??
    SYSTEM_MAX_ATTEMPTS;

  const multiplier =
    options.multiplier ??
    options.backoffMultiplier ??
    options.retryBackoffMultiplier ??
    options.retry_backoff_multiplier ??
    2.0;

  const retryLimitedMaxAttempts = Math.min(RETRY_LIMITED_MAX_ATTEMPTS, maxAttempts);

  return {
    strategy: 'EXPONENTIAL',
    baseDelayMs,
    maxDelayMs,
    maxAttempts,
    multiplier,

    /**
     * Calculate next retry delay with full jitter.
     * @param {number} attemptCount - Current attempt count (1-indexed)
     * @param {Object|string} outcome - Delivery outcome
     * @param {Object} [random=randomGenerator.system] - RandomGenerator instance
     * @returns {Promise<number|null>} Delay in milliseconds, or null if no more retries
     */
    async nextDelay(attemptCount, outcome, random = randomGenerator.system) {
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

      // Calculate exponential delay with full jitter
      const exponent = Math.min(attemptCount - 1, 30); // Cap to avoid integer overflow
      const exponentialDelay = baseDelayMs * Math.pow(multiplier, exponent);
      const cappedDelay = Math.min(exponentialDelay, maxDelayMs);

      // Full jitter: uniform random in [0, ceiling]
      const delay = random.nextInt(0, Math.floor(cappedDelay) + 1);

      return delay;
    },
  };
}

// Default singleton instance using system configuration
export const defaultPolicy = createExponentialJitterRetryPolicy({
  baseDelayMs: SYSTEM_BASE_DELAY_MS,
  maxDelayMs: SYSTEM_MAX_DELAY_MS,
  maxAttempts: SYSTEM_MAX_ATTEMPTS,
  multiplier: 2.0,
});

/**
 * Backward-compatible calculate next retry delay function.
 * @param {number} attemptCount - Current attempt count (1-indexed)
 * @param {Object} outcome - Delivery outcome
 * @param {Object} random - RandomGenerator instance (defaults to system)
 * @returns {Promise<number|null>} Delay in milliseconds, or null if no more retries
 */
export async function nextDelay(attemptCount, outcome, random = randomGenerator.system) {
  return defaultPolicy.nextDelay(attemptCount, outcome, random);
}

export default {
  nextDelay,
  createExponentialJitterRetryPolicy,
  defaultPolicy,
};
