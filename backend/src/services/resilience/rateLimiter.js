/**
 * RateLimiter port interface.
 * Per-endpoint rate limiting for webhook delivery.
 */

/**
 * Check if request is allowed based on rate limit.
 * @param {string} endpointId - Endpoint UUID
 * @param {number} permitsPerSecond - Rate limit in requests per second
 * @returns {Promise<boolean>} True if request is allowed
 */
export async function tryAcquire(endpointId, permitsPerSecond) {
  throw new Error('RateLimiter.tryAcquire must be implemented');
}

export default {
  tryAcquire,
};
