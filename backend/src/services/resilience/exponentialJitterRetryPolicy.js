/**
 * ExponentialJitterRetryPolicy - Retry policy with exponential backoff and full jitter.
 * Formula: delay = random(0, min(cap, base * 2^(attempts-1)))
 */

import { deliveryOutcome } from '../../domain/deliveryOutcome.js';
import randomGenerator from '../../utils/random.js';

const BASE_DELAY_MS = 5000; // 5 seconds
const MAX_DELAY_MS = 3600000; // 1 hour
const MAX_ATTEMPTS = 8;
const RETRY_LIMITED_MAX_ATTEMPTS = 3;

/**
 * Calculate next retry delay.
 * @param {number} attemptCount - Current attempt count (1-indexed)
 * @param {Object} outcome - Delivery outcome
 * @param {Object} random - RandomGenerator instance (defaults to system)
 * @returns {Promise<number|null>} Delay in milliseconds, or null if no more retries
 */
export async function nextDelay(attemptCount, outcome, random = randomGenerator.system) {
  // Non-retryable outcomes
  if (outcome === deliveryOutcome.SUCCESS || outcome === deliveryOutcome.ENDPOINT_GONE) {
    return null;
  }

  // Determine max attempts based on outcome
  const maxAttempts = outcome === deliveryOutcome.RETRY_LIMITED
    ? RETRY_LIMITED_MAX_ATTEMPTS
    : MAX_ATTEMPTS;

  // No more retries
  if (attemptCount >= maxAttempts) {
    return null;
  }

  // Calculate exponential delay with full jitter
  const exponent = Math.min(attemptCount - 1, 30); // Cap to avoid overflow
  const exponentialDelay = BASE_DELAY_MS * Math.pow(2, exponent);
  const cappedDelay = Math.min(exponentialDelay, MAX_DELAY_MS);

  // Full jitter: uniform random in [0, ceiling]
  const delay = random.nextInt(0, cappedDelay + 1);

  return delay;
}

export default {
  nextDelay,
};
