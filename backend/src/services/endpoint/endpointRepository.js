/**
 * EndpointRepository port interface.
 * Defines the contract for endpoint data access.
 */

/**
 * Insert a new endpoint.
 * @param {string} tenantId - Tenant UUID
 * @param {string} url - Webhook URL
 * @param {string} secret - HMAC signing secret
 * @param {number} rateLimitRps - Rate limit in requests per second
 * @returns {Promise<Object>} Created endpoint object
 */
export async function insert(tenantId, url, secret, rateLimitRps) {
  throw new Error('EndpointRepository.insert must be implemented');
}

/**
 * Find endpoint by ID and tenant (tenant-scoped access).
 * @param {string} id - Endpoint UUID
 * @param {string} tenantId - Tenant UUID
 * @returns {Promise<Object|null>} Endpoint object or null if not found
 */
export async function findByIdAndTenant(id, tenantId) {
  throw new Error('EndpointRepository.findByIdAndTenant must be implemented');
}

/**
 * Find all endpoints for a tenant.
 * @param {string} tenantId - Tenant UUID
 * @returns {Promise<Array>} Array of endpoint objects
 */
export async function findAllByTenant(tenantId) {
  throw new Error('EndpointRepository.findAllByTenant must be implemented');
}

/**
 * Find active endpoints for a tenant (ORDER BY id for stable lock order).
 * @param {string} tenantId - Tenant UUID
 * @returns {Promise<Array>} Array of active endpoint objects
 */
export async function findActiveByTenant(tenantId) {
  throw new Error('EndpointRepository.findActiveByTenant must be implemented');
}

/**
 * Update an endpoint.
 * @param {Object} endpoint - Endpoint object with updated fields
 * @returns {Promise<Object>} Updated endpoint object
 */
export async function update(endpoint) {
  throw new Error('EndpointRepository.update must be implemented');
}

export default {
  insert,
  findByIdAndTenant,
  findAllByTenant,
  findActiveByTenant,
  update,
};
