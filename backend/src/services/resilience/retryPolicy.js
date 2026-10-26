/**
 * RetryPolicy port interface.
 * Calculates retry delay based on attempt count and outcome.
 */

/**
 * Calculate next retry delay for a delivery.
 * @param {number} attemptCount - Current attempt count (1-indexed)
 * @param {Object} outcome - Delivery outcome
 * @returns {Promise<number|null>} Delay in milliseconds, or null if no more retries
 */
export async function nextDelay(attemptCount, outcome) {
  throw new Error('RetryPolicy.nextDelay must be implemented');
}

export default {
  nextDelay,
};
