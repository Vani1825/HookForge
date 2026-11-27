/**
 * JdbcApiKeyRepository - Multiple workspace API keys per tenant.
 */

import { query } from '../../config/database.js';
import logger from '../../utils/logger.js';

/**
 * Create a new API key record for a tenant.
 * @param {Object} data
 * @param {string} data.tenantId
 * @param {string} data.name
 * @param {string} data.keyPrefix
 * @param {string} data.keyHash - SHA-256 hash of API key
 * @param {Object} [client]
 * @returns {Promise<Object>}
 */
export async function createApiKey({ tenantId, name, keyPrefix, keyHash }, client = null) {
  const sql = `
    INSERT INTO api_keys (tenant_id, name, key_prefix, key_hash, created_at)
    VALUES ($1, $2, $3, $4, NOW())
    RETURNING id, tenant_id, name, key_prefix, created_at, last_used_at, revoked_at
  `;
  const params = [tenantId, name.trim(), keyPrefix, keyHash];
  try {
    const res = client ? await client.query(sql, params) : await query(sql, params);
    return res.rows[0];
  } catch (err) {
    logger.error('Failed to create api key record', { error: err.message, tenantId });
    throw err;
  }
}

/**
 * Find active API key by its SHA-256 hash.
 * @param {string} keyHash
 * @returns {Promise<Object|null>}
 */
export async function findActiveByKeyHash(keyHash) {
  const sql = `
    SELECT ak.id, ak.tenant_id, ak.name, ak.key_prefix, ak.created_at, ak.last_used_at,
           t.name as tenant_name
    FROM api_keys ak
    JOIN tenants t ON ak.tenant_id = t.id
    WHERE ak.key_hash = $1 AND ak.revoked_at IS NULL
    LIMIT 1
  `;
  try {
    const res = await query(sql, [keyHash]);
    if (res.rows.length === 0) return null;

    // Asynchronously update last_used_at
    query('UPDATE api_keys SET last_used_at = NOW() WHERE id = $1', [res.rows[0].id]).catch(() => {});

    return {
      id: res.rows[0].id,
      tenantId: res.rows[0].tenant_id,
      name: res.rows[0].name,
      tenantName: res.rows[0].tenant_name,
    };
  } catch (err) {
    logger.error('Failed to find active api key by hash', { error: err.message });
    throw err;
  }
}

/**
 * List all API keys for a tenant.
 * Note: Never returns key hashes.
 * @param {string} tenantId
 * @returns {Promise<Array<Object>>}
 */
export async function listByTenantId(tenantId) {
  const sql = `
    SELECT id, tenant_id, name, key_prefix, created_at, last_used_at, revoked_at
    FROM api_keys
    WHERE tenant_id = $1
    ORDER BY created_at DESC
  `;
  try {
    const res = await query(sql, [tenantId]);
    return res.rows;
  } catch (err) {
    logger.error('Failed to list api keys by tenant', { error: err.message, tenantId });
    throw err;
  }
}

/**
 * Revoke an API key.
 * @param {string} keyId
 * @param {string} tenantId
 * @returns {Promise<boolean>}
 */
export async function revokeApiKey(keyId, tenantId) {
  const sql = `
    UPDATE api_keys
    SET revoked_at = NOW()
    WHERE id = $1 AND tenant_id = $2 AND revoked_at IS NULL
  `;
  try {
    const res = await query(sql, [keyId, tenantId]);
    return res.rowCount > 0;
  } catch (err) {
    logger.error('Failed to revoke api key', { error: err.message, keyId, tenantId });
    throw err;
  }
}

export default {
  createApiKey,
  findActiveByKeyHash,
  listByTenantId,
  revokeApiKey,
};
