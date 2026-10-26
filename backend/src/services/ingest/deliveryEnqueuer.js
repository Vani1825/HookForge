/**
 * DeliveryEnqueuer port interface.
 * Enqueues deliveries for an event to active endpoints.
 */

/**
 * Enqueue a delivery for an event to an endpoint.
 * @param {string} eventId - Event UUID
 * @param {string} endpointId - Endpoint UUID
 * @param {number} seq - Sequence number
 * @returns {Promise<Object>} Created delivery object
 */
export async function enqueue(eventId, endpointId, seq) {
  throw new Error('DeliveryEnqueuer.enqueue must be implemented');
}

export default {
  enqueue,
};
