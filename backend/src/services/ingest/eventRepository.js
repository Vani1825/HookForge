/**
 * EventRepository port interface.
 * Defines the contract for event data access.
 */

/**
 * Insert a new event with idempotency constraint.
 * @param {string} tenantId - Tenant UUID
 * @param {string} payloadJson - JSON payload as string
 * @param {string} idempotencyKey - Idempotency key
 * @returns {Promise<Object>} Created event object
 */
export async function insert(tenantId, payloadJson, idempotencyKey) {
  throw new Error('EventRepository.insert must be implemented');
}

/**
 * Find event by tenant and idempotency key.
 * @param {string} tenantId - Tenant UUID
 * @param {string} idempotencyKey - Idempotency key
 * @returns {Promise<Object|null>} Event object or null if not found
 */
export async function findByTenantAndIdempotencyKey(tenantId, idempotencyKey) {
  throw new Error('EventRepository.findByTenantAndIdempotencyKey must be implemented');
}

/**
 * Find event by ID.
 * @param {string} id - Event UUID
 * @returns {Promise<Object|null>} Event object or null if not found
 */
export async function findById(id) {
  throw new Error('EventRepository.findById must be implemented');
}

export default {
  insert,
  findByTenantAndIdempotencyKey,
  findById,
};
