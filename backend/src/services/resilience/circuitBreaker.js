/**
 * CircuitBreaker port interface.
 * Per-endpoint circuit breaker for resilience.
 */

/**
 * Should attempt delivery based on circuit state.
 * @param {string} endpointId - Endpoint UUID
 * @param {Object} endpoint - Endpoint object with circuit state
 * @param {number} now - Current timestamp in milliseconds
 * @returns {Promise<boolean>} True if delivery should be attempted
 */
export async function shouldAttempt(endpointId, endpoint, now) {
  throw new Error('CircuitBreaker.shouldAttempt must be implemented');
}

/**
 * Record delivery result and update circuit state.
 * @param {string} endpointId - Endpoint UUID
 * @param {Object} outcome - Delivery outcome
 * @param {number} now - Current timestamp in milliseconds
 * @returns {Promise<Object>} Circuit state update
 */
export async function recordResult(endpointId, outcome, now) {
  throw new Error('CircuitBreaker.recordResult must be implemented');
}

export default {
  shouldAttempt,
  recordResult,
};
