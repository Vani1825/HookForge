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

/**
 * Atomically allocate sequence numbers and enqueue deliveries for all active endpoints of a tenant.
 * @param {string} tenantId - Tenant UUID
 * @param {string} eventId - Event UUID
 * @returns {Promise<Array<Object>>} Created delivery objects
 */
export async function enqueueBatch(tenantId, eventId) {
  throw new Error('DeliveryEnqueuer.enqueueBatch must be implemented');
}

export default {
  enqueue,
  enqueueBatch,
};
