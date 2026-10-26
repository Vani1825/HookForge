/**
 * TokenBucketRateLimiter - Per-endpoint in-memory token bucket rate limiter.
 * Single-node limitation (documented - multi-node would need shared limiter).
 */

import clock from '../../utils/clock.js';

const buckets = new Map(); // endpointId -> { tokens, lastRefillNanos }

/**
 * Check if request is allowed based on rate limit.
 * @param {string} endpointId - Endpoint UUID
 * @param {number} permitsPerSecond - Rate limit in requests per second
 * @param {Object} timeSource - Clock instance (defaults to system)
 * @returns {Promise<boolean>} True if request is allowed
 */
export async function tryAcquire(endpointId, permitsPerSecond, timeSource = clock.system) {
  const nowNanos = BigInt(timeSource.now()) * 1000000n;
  const bucket = buckets.get(endpointId);

  if (!bucket) {
    // Create new bucket with capacity = permitsPerSecond - 1 (allows 1s burst)
    // We deduct 1 immediately since this request is being allowed
    buckets.set(endpointId, {
      tokens: BigInt(permitsPerSecond - 1),
      lastRefillNanos: nowNanos,
    });
    return true;
  }

  // Refill tokens based on elapsed time
  const elapsedNanos = nowNanos - bucket.lastRefillNanos;
  const elapsedSeconds = Number(elapsedNanos) / 1e9;
  const newTokens = elapsedSeconds * permitsPerSecond;
  bucket.tokens = bucket.tokens + BigInt(Math.floor(newTokens));
  // Cap at capacity
  const capacity = BigInt(permitsPerSecond);
  if (bucket.tokens > capacity) {
    bucket.tokens = capacity;
  }
  bucket.lastRefillNanos = nowNanos;

  // Acquire one token
  if (bucket.tokens > 0n) {
    bucket.tokens -= 1n;
    return true;
  }

  return false;
}

/**
 * Clear all buckets (useful for tests)
 */
export function clear() {
  buckets.clear();
}

export default {
  tryAcquire,
  clear,
};
