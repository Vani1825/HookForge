/**
 * JdbcTenantRepository - PostgreSQL adapter for TenantRepository port.
 * Implements tenant data access using parameterized SQL queries with TTL cache.
 */

import { query } from '../../config/database.js';
import config from '../../config/index.js';
import logger from '../../utils/logger.js';
import { defaultTenantKeyCache } from '../../services/tenant/tenantKeyCache.js';

let activeCache = defaultTenantKeyCache;

/**
 * Configure or override the cache instance (primarily for tests).
 * @param {import('../../services/tenant/tenantKeyCache.js').TenantKeyCache|null} cache
 */
export function setCache(cache) {
  activeCache = cache;
}

/**
 * Clear the tenant key cache.
 */
export function clearCache() {
  if (activeCache) {
    activeCache.clear();
  }
}

/**
 * Invalidate a specific tenant by API key hash.
 * @param {string} apiKeyHash
 * @returns {boolean}
 */
export function invalidateCache(apiKeyHash) {
  if (activeCache) {
    return activeCache.invalidate(apiKeyHash);
  }
  return false;
}

/**
 * Get cache statistics.
 * @returns {Object|null}
 */
export function getCacheStats() {
  if (activeCache) {
    return activeCache.getStats();
  }
  return null;
}

/**
 * Find a tenant by API key hash.
 * Uses in-memory TTL caching with single-flight protection when enabled.
 * Uses parameterized SQL to prevent SQL injection.
 *
 * @param {string} apiKeyHash - SHA-256 hex hash of the API key
 * @returns {Promise<Object|null>} Tenant object with {id, name} or null if not found
 */
export async function findByApiKeyHash(apiKeyHash) {
  if (!apiKeyHash) {
    return null;
  }

  const isCacheEnabled = config.authCache?.enabled !== false && activeCache !== null;

  const fetchFromDb = async () => {
    const sql = `
      SELECT id, name
      FROM tenants
      WHERE api_key_hash = $1
    `;

    try {
      const result = await query(sql, [apiKeyHash]);

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        id: row.id,
        name: row.name,
      };
    } catch (error) {
      logger.error('Failed to find tenant by API key hash', {
        error: error.message,
      });
      throw error;
    }
  };

  if (!isCacheEnabled) {
    return await fetchFromDb();
  }

  return await activeCache.getOrFetch(apiKeyHash, fetchFromDb);
}

/**
 * Find all tenants.
 * @returns {Promise<Array>} Array of tenant objects
 */
export async function findAll() {
  const sql = `
    SELECT id, name
    FROM tenants
  `;

  try {
    const result = await query(sql);
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
    }));
  } catch (error) {
    logger.error('Failed to find all tenants', {
      error: error.message,
    });
    throw error;
  }
}

export default {
  findByApiKeyHash,
  findAll,
  clearCache,
  invalidateCache,
  getCacheStats,
  setCache,
};
