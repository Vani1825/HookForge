/**
 * DeliveryOutcomeRecorder port interface.
 * Records delivery attempts and outcome updates.
 */

/**
 * Record a delivery attempt.
 * @param {Object} attempt - Delivery attempt object
 * @returns {Promise<void>}
 */
export async function recordAttempt(attempt) {
  throw new Error('DeliveryOutcomeRecorder.recordAttempt must be implemented');
}

/**
 * Update delivery state based on outcome.
 * @param {string} deliveryId - Delivery UUID
 * @param {Object} state - New delivery state
 * @param {number} nextAttemptAt - Next attempt timestamp
 * @param {string} lastError - Last error message
 * @returns {Promise<void>}
 */
export async function updateState(deliveryId, state, nextAttemptAt, lastError) {
  throw new Error('DeliveryOutcomeRecorder.updateState must be implemented');
}

export default {
  recordAttempt,
  updateState,
};
