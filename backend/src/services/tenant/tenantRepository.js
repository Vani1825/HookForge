/**
 * TenantRepository port interface.
 * Defines the contract for tenant data access.
 *
 * Port interface for tenant repository operations.
 * Implementations should query the tenants table by api_key_hash.
 */

/**
 * Find a tenant by API key hash.
 * @param {string} apiKeyHash - SHA-256 hex hash of the API key
 * @returns {Promise<Object|null>} Tenant object with {id, name} or null if not found
 */
export async function findByApiKeyHash(apiKeyHash) {
  throw new Error('TenantRepository.findByApiKeyHash must be implemented');
}

export default {
  findByApiKeyHash,
};
