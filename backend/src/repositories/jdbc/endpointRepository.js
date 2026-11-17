/**
 * JdbcEndpointRepository - PostgreSQL adapter for endpoint ports.
 * Implements EndpointRepository, SequenceAllocator, and EndpointHealthStore ports.
 */

import { query } from '../../config/database.js';
import { createEndpoint } from '../../domain/models/endpoint.js';
import { circuitState } from '../../domain/circuitState.js';
import { encryptSecret, decryptSecret } from '../../utils/secretEncryption.js';
import logger from '../../utils/logger.js';

// Row mapper for Endpoint domain model
function mapRowToEndpoint(row) {
  let secret = null;

  if (row.secret_ciphertext) {
    // Decrypt encrypted secret; fails closed if ciphertext is malformed or tampered
    secret = decryptSecret(row);
  } else if (row.secret) {
    // Backward-compatible fallback for unmigrated legacy plaintext records
    secret = row.secret;
  } else {
    throw new Error(`Endpoint ${row.id} has no secret configured`);
  }

  return createEndpoint({
    id: row.id,
    tenantId: row.tenant_id,
    url: row.url,
    secret,
    secretCiphertext: row.secret_ciphertext,
    secretIv: row.secret_iv,
    secretTag: row.secret_tag,
    secretVersion: row.secret_version,
    active: row.active,
    rateLimitRps: row.rate_limit_rps,
    nextSeq: row.next_seq,
    circuitState: circuitState.fromString(row.circuit_state),
    circuitUntil: row.circuit_until
      ? row.circuit_until instanceof Date
        ? row.circuit_until.toISOString()
        : row.circuit_until
      : null,
    consecutiveFailures: row.consecutive_failures,
    createdAt: row.created_at
      ? row.created_at instanceof Date
        ? row.created_at.toISOString()
        : row.created_at
      : new Date().toISOString(),
  });
}

// ============ EndpointRepository Implementation ============

/**
 * Insert a new endpoint.
 * Encrypts the signing secret at rest using AES-256-GCM before database insertion.
 */
export async function insert(tenantId, url, secret, rateLimitRps) {
  let encrypted;
  let plaintextSecret = null;

  if (typeof secret === 'string') {
    plaintextSecret = secret;
    encrypted = encryptSecret(secret);
  } else if (typeof secret === 'object' && secret !== null && secret.ciphertext) {
    encrypted = secret;
    plaintextSecret = secret.plaintext || null;
  } else {
    throw new Error('Secret must be provided as a string or encrypted secret object');
  }

  const sql = `
    INSERT INTO endpoints (
      tenant_id,
      url,
      secret,
      rate_limit_rps,
      secret_ciphertext,
      secret_iv,
      secret_tag,
      secret_version
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `;

  try {
    const result = await query(sql, [
      tenantId,
      url,
      null, // legacy secret column stored as NULL for newly encrypted secrets
      rateLimitRps,
      encrypted.ciphertext,
      encrypted.iv,
      encrypted.tag,
      encrypted.version,
    ]);

    const created = mapRowToEndpoint(result.rows[0]);
    if (plaintextSecret && !created.secret) {
      return createEndpoint({ ...created, secret: plaintextSecret });
    }
    return created;
  } catch (error) {
    logger.error('Failed to insert endpoint', { error: error.message });
    throw error;
  }
}

/**
 * Find endpoint by ID (without tenant scoping).
 * @param {string} id - Endpoint UUID
 * @param {Object} [client=null] - Optional database client
 * @returns {Promise<Object|null>} Endpoint domain model or null
 */
export async function findById(id, client = null) {
  const sql = `
    SELECT *
    FROM endpoints
    WHERE id = $1
  `;

  const queryFn = client ? (text, params) => client.query(text, params) : query;

  try {
    const result = await queryFn(sql, [id]);
    if (result.rows.length === 0) {
      return null;
    }
    return mapRowToEndpoint(result.rows[0]);
  } catch (error) {
    logger.error('Failed to find endpoint by ID', {
      error: error.message,
      endpointId: id,
    });
    throw error;
  }
}

/**
 * Find endpoint by ID and tenant (tenant-scoped access).
 */
export async function findByIdAndTenant(id, tenantId) {
  const sql = `
    SELECT *
    FROM endpoints
    WHERE id = $1 AND tenant_id = $2
  `;

  try {
    const result = await query(sql, [id, tenantId]);
    if (result.rows.length === 0) {
      return null;
    }
    return mapRowToEndpoint(result.rows[0]);
  } catch (error) {
    logger.error('Failed to find endpoint by ID and tenant', {
      error: error.message,
    });
    throw error;
  }
}

/**
 * Find all endpoints for a tenant.
 */
export async function findAllByTenant(tenantId) {
  const sql = `
    SELECT *
    FROM endpoints
    WHERE tenant_id = $1
    ORDER BY created_at DESC
  `;

  try {
    const result = await query(sql, [tenantId]);
    return result.rows.map(mapRowToEndpoint);
  } catch (error) {
    logger.error('Failed to find all endpoints for tenant', {
      error: error.message,
    });
    throw error;
  }
}

/**
 * Find active endpoints for a tenant (ORDER BY id for stable lock order).
 */
export async function findActiveByTenant(tenantId, client = null) {
  const sql = `
    SELECT *
    FROM endpoints
    WHERE tenant_id = $1 AND active = true
    ORDER BY id
  `;

  const queryFn = client ? (text, params) => client.query(text, params) : query;

  try {
    const result = await queryFn(sql, [tenantId]);
    return result.rows.map(mapRowToEndpoint);
  } catch (error) {
    logger.error('Failed to find active endpoints for tenant', {
      error: error.message,
    });
    throw error;
  }
}

/**
 * Find active endpoints with deliveries due for dispatch, ordered by earliest due delivery.
 * Uses queue-driven discovery to avoid blind polling of all tenants and endpoints.
 * Preserves strict FIFO ordering by only discovering endpoints whose head-of-line delivery is due.
 *
 * @param {number} limit - Maximum number of candidate endpoints to return
 * @param {Object} [client=null] - Optional database client
 * @returns {Promise<Array<Object>>} List of candidate Endpoint domain models
 */
export async function findDueEndpoints(limit = 50, client = null) {
  const sql = `
    SELECT
      e.*,
      MIN(d.next_attempt_at) AS earliest_due
    FROM deliveries d
    JOIN endpoints e ON d.endpoint_id = e.id
    WHERE d.state IN ('PENDING', 'RETRYING')
      AND d.next_attempt_at <= now()
      AND e.active = true
      AND d.seq = (
        SELECT MIN(d2.seq)
        FROM deliveries d2
        WHERE d2.endpoint_id = d.endpoint_id
          AND d2.state IN ('PENDING', 'RETRYING', 'IN_FLIGHT')
      )
    GROUP BY e.id
    ORDER BY earliest_due ASC
    LIMIT $1
  `;

  const queryFn = client ? (text, params) => client.query(text, params) : query;

  try {
    const result = await queryFn(sql, [limit]);
    return result.rows.map(mapRowToEndpoint);
  } catch (error) {
    logger.error('Failed to find due endpoints', { error: error.message });
    throw error;
  }
}

/**
 * Update an endpoint.
 */
export async function update(endpoint) {
  const sql = `
    UPDATE endpoints
    SET url = $1,
        active = $2,
        rate_limit_rps = $3,
        circuit_state = $4,
        circuit_until = $5,
        consecutive_failures = $6
    WHERE id = $7 AND tenant_id = $8
    RETURNING *
  `;

  try {
    const result = await query(sql, [
      endpoint.url,
      endpoint.active,
      endpoint.rateLimitRps,
      endpoint.circuitState.toString(),
      endpoint.circuitUntil,
      endpoint.consecutiveFailures,
      endpoint.id,
      endpoint.tenantId,
    ]);
    if (result.rows.length === 0) {
      return null;
    }
    return mapRowToEndpoint(result.rows[0]);
  } catch (error) {
    logger.error('Failed to update endpoint', { error: error.message });
    throw error;
  }
}

// ============ SequenceAllocator Implementation ============

/**
 * Allocate the next sequence number for an endpoint.
 * Atomically increments and returns the value BEFORE increment.
 */
export async function allocate(endpointId, client = null) {
  const sql = `
    UPDATE endpoints
    SET next_seq = next_seq + 1
    WHERE id = $1
    RETURNING next_seq - 1 AS allocated_seq
  `;

  const queryFn = client ? (text, params) => client.query(text, params) : query;

  try {
    const result = await queryFn(sql, [endpointId]);
    if (result.rows.length === 0) {
      throw new Error(`Endpoint not found: ${endpointId}`);
    }
    return result.rows[0].allocated_seq;
  } catch (error) {
    logger.error('Failed to allocate sequence number', {
      error: error.message,
      endpointId,
    });
    throw error;
  }
}

// ============ EndpointHealthStore Implementation ============

/**
 * Save circuit breaker state update.
 */
export async function saveCircuit(endpointId, update) {
  const { circuitState, circuitUntil, consecutiveFailures } = update;

  const sql = `
    UPDATE endpoints
    SET circuit_state = $1,
        circuit_until = $2,
        consecutive_failures = $3
    WHERE id = $4
  `;

  try {
    await query(sql, [
      circuitState.toString(),
      circuitUntil,
      consecutiveFailures,
      endpointId,
    ]);
  } catch (error) {
    logger.error('Failed to save circuit state', {
      error: error.message,
      endpointId,
    });
    throw error;
  }
}

/**
 * Deactivate an endpoint.
 */
export async function deactivate(endpointId) {
  const sql = `
    UPDATE endpoints
    SET active = false
    WHERE id = $1
  `;

  try {
    await query(sql, [endpointId]);
  } catch (error) {
    logger.error('Failed to deactivate endpoint', {
      error: error.message,
      endpointId,
    });
    throw error;
  }
}

export default {
  // EndpointRepository
  insert,
  findById,
  findByIdAndTenant,
  findAllByTenant,
  findActiveByTenant,
  findDueEndpoints,
  update,
  // SequenceAllocator
  allocate,
  // EndpointHealthStore
  saveCircuit,
  deactivate,
};
