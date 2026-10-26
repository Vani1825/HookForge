/**
 * DeliveryQueries port interface.
 * Query deliveries for status APIs.
 */

/**
 * Find deliveries by event ID.
 * @param {string} eventId - Event UUID
 * @returns {Promise<Array>} Array of delivery objects
 */
export async function findByEvent(eventId) {
  throw new Error('DeliveryQueries.findByEvent must be implemented');
}

/**
 * Find deliveries by state.
 * @param {string} state - Delivery state
 * @param {number} limit - Max results
 * @returns {Promise<Array>} Array of delivery objects
 */
export async function findByState(state, limit) {
  throw new Error('DeliveryQueries.findByState must be implemented');
}

export default {
  findByEvent,
  findByState,
};
