/**
 * JdbcEndpointRepository - PostgreSQL adapter for endpoint ports.
 * Implements EndpointRepository, SequenceAllocator, and EndpointHealthStore ports.
 */

import { query } from '../../config/database.js';
import { createEndpoint } from '../../domain/models/endpoint.js';
import { circuitState } from '../../domain/circuitState.js';
import logger from '../../utils/logger.js';

// Row mapper for Endpoint domain model
function mapRowToEndpoint(row) {
  return createEndpoint({
    id: row.id,
    tenantId: row.tenant_id,
    url: row.url,
    secret: row.secret,
    active: row.active,
    rateLimitRps: row.rate_limit_rps,
    nextSeq: row.next_seq,
    circuitState: circuitState.fromString(row.circuit_state),
    circuitUntil: row.circuit_until ? row.circuit_until.toISOString() : null,
    consecutiveFailures: row.consecutive_failures,
    createdAt: row.created_at.toISOString(),
  });
}

// ============ EndpointRepository Implementation ============

/**
 * Insert a new endpoint.
 */
export async function insert(tenantId, url, secret, rateLimitRps) {
  const sql = `
    INSERT INTO endpoints (tenant_id, url, secret, rate_limit_rps)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `;

  try {
    const result = await query(sql, [tenantId, url, secret, rateLimitRps]);
    return mapRowToEndpoint(result.rows[0]);
  } catch (error) {
    logger.error('Failed to insert endpoint', { error: error.message });
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
export async function findActiveByTenant(tenantId) {
  const sql = `
    SELECT *
    FROM endpoints
    WHERE tenant_id = $1 AND active = true
    ORDER BY id
  `;

  try {
    const result = await query(sql, [tenantId]);
    return result.rows.map(mapRowToEndpoint);
  } catch (error) {
    logger.error('Failed to find active endpoints for tenant', {
      error: error.message,
    });
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
export async function allocate(endpointId) {
  const sql = `
    UPDATE endpoints
    SET next_seq = next_seq + 1
    WHERE id = $1
    RETURNING next_seq - 1 AS allocated_seq
  `;

  try {
    const result = await query(sql, [endpointId]);
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
  findByIdAndTenant,
  findAllByTenant,
  findActiveByTenant,
  update,
  // SequenceAllocator
  allocate,
  // EndpointHealthStore
  saveCircuit,
  deactivate,
};
