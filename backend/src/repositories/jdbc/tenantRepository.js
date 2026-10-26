/**
 * JdbcTenantRepository - PostgreSQL adapter for TenantRepository port.
 * Implements tenant data access using parameterized SQL queries.
 */

import { query } from '../../config/database.js';
import logger from '../../utils/logger.js';

/**
 * Find a tenant by API key hash.
 * Uses parameterized SQL to prevent SQL injection.
 *
 * @param {string} apiKeyHash - SHA-256 hex hash of the API key
 * @returns {Promise<Object|null>} Tenant object with {id, name} or null if not found
 */
export async function findByApiKeyHash(apiKeyHash) {
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
};
