/**
 * JdbcEventRepository - PostgreSQL adapter for EventRepository and DeliveryEnqueuer ports.
 * Implements event and delivery data access with transaction support.
 */

import { query } from '../../config/database.js';
import { createEvent } from '../../domain/models/event.js';
import { createDelivery } from '../../domain/models/delivery.js';
import logger from '../../utils/logger.js';

// Row mapper for Event domain model
function mapRowToEvent(row) {
  return createEvent({
    id: row.id,
    tenantId: row.tenant_id,
    payloadJson: typeof row.payload === 'string' ? row.payload : JSON.stringify(row.payload),
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at.toISOString(),
  });
}

// Row mapper for Delivery domain model
function mapRowToDelivery(row) {
  return createDelivery({
    id: row.id,
    eventId: row.event_id,
    endpointId: row.endpoint_id,
    seq: row.seq,
    state: row.state,
    attemptCount: row.attempt_count,
    nextAttemptAt: row.next_attempt_at instanceof Date
      ? row.next_attempt_at.toISOString()
      : (row.next_attempt_at ? new Date(row.next_attempt_at).toISOString() : null),
    leaseUntil: row.lease_until
      ? (row.lease_until instanceof Date ? row.lease_until.toISOString() : new Date(row.lease_until).toISOString())
      : null,
    lastError: row.last_error,
    createdAt: row.created_at instanceof Date
      ? row.created_at.toISOString()
      : (row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString()),
    updatedAt: row.updated_at instanceof Date
      ? row.updated_at.toISOString()
      : (row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString()),
  });
}

// ============ EventRepository Implementation ============

/**
 * Insert a new event with idempotency constraint.
 * Uses ON CONFLICT (tenant_id, idempotency_key) DO NOTHING for concurrency safety.
 * Returns null if a conflict occurred (duplicate idempotency key).
 */
export async function insert(tenantId, payloadJson, idempotencyKey, client = null) {
  const sql = `
    INSERT INTO events (tenant_id, payload, idempotency_key)
    VALUES ($1, $2::jsonb, $3)
    ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
    RETURNING *
  `;

  const queryFn = client ? (text, params) => client.query(text, params) : query;

  try {
    const result = await queryFn(sql, [tenantId, payloadJson, idempotencyKey]);
    if (result.rows.length === 0) {
      return null;
    }
    return mapRowToEvent(result.rows[0]);
  } catch (error) {
    logger.error('Failed to insert event', { error: error.message });
    throw error;
  }
}

/**
 * Find event by tenant and idempotency key.
 */
export async function findByTenantAndIdempotencyKey(tenantId, idempotencyKey, client = null) {
  const sql = `
    SELECT *
    FROM events
    WHERE tenant_id = $1 AND idempotency_key = $2
  `;

  const queryFn = client ? (text, params) => client.query(text, params) : query;

  try {
    const result = await queryFn(sql, [tenantId, idempotencyKey]);
    if (result.rows.length === 0) {
      return null;
    }
    return mapRowToEvent(result.rows[0]);
  } catch (error) {
    logger.error('Failed to find event by idempotency key', {
      error: error.message,
    });
    throw error;
  }
}

/**
 * Find event by ID.
 */
export async function findById(id) {
  const sql = `
    SELECT *
    FROM events
    WHERE id = $1
  `;

  try {
    const result = await query(sql, [id]);
    if (result.rows.length === 0) {
      return null;
    }
    return mapRowToEvent(result.rows[0]);
  } catch (error) {
    logger.error('Failed to find event by ID', { error: error.message });
    throw error;
  }
}

/**
 * Find all events by tenant (tenant-scoped).
 */
export async function findAllByTenant(tenantId, limit = 100) {
  const sql = `
    SELECT id, tenant_id, payload, idempotency_key, created_at
    FROM events
    WHERE tenant_id = $1
    ORDER BY created_at DESC
    LIMIT $2
  `;

  try {
    const result = await query(sql, [tenantId, limit]);
    return result.rows.map(mapRowToEvent);
  } catch (error) {
    logger.error('Failed to list events by tenant', { error: error.message, tenantId });
    throw error;
  }
}

// ============ DeliveryEnqueuer Implementation ============

/**
 * Enqueue a delivery for an event to an endpoint.
 */
export async function enqueue(eventId, endpointId, seq, client = null) {
  const sql = `
    INSERT INTO deliveries (event_id, endpoint_id, seq, state, attempt_count, next_attempt_at)
    VALUES ($1, $2, $3, 'PENDING', 0, now())
    RETURNING *
  `;

  const queryFn = client ? (text, params) => client.query(text, params) : query;

  try {
    const result = await queryFn(sql, [eventId, endpointId, seq]);
    return createDelivery({
      id: result.rows[0].id,
      eventId: result.rows[0].event_id,
      endpointId: result.rows[0].endpoint_id,
      seq: result.rows[0].seq,
      state: result.rows[0].state,
      attemptCount: result.rows[0].attempt_count,
      nextAttemptAt: result.rows[0].next_attempt_at.toISOString(),
      leaseUntil: result.rows[0].lease_until,
      lastError: result.rows[0].last_error,
      createdAt: result.rows[0].created_at.toISOString(),
      updatedAt: result.rows[0].updated_at.toISOString(),
    });
  } catch (error) {
    logger.error('Failed to enqueue delivery', { error: error.message });
    throw error;
  }
}

/**
 * Atomically allocate sequence numbers and enqueue deliveries for all active endpoints of a tenant.
 * Uses a single set-based Common Table Expression (CTE) query to eliminate per-endpoint roundtrips.
 *
 * @param {string} tenantId - Tenant UUID
 * @param {string} eventId - Event UUID
 * @param {Object} [client=null] - Transaction database client
 * @returns {Promise<Array<Object>>} Enqueued delivery domain models
 */
export async function enqueueBatch(tenantId, eventId, client = null) {
  const sql = `
    WITH locked_endpoints AS (
      SELECT id
      FROM endpoints
      WHERE tenant_id = $1 AND active = true
      ORDER BY id
      FOR UPDATE
    ),
    updated_endpoints AS (
      UPDATE endpoints e
      SET next_seq = e.next_seq + 1
      FROM locked_endpoints l
      WHERE e.id = l.id
      RETURNING e.id AS endpoint_id, e.next_seq - 1 AS seq
    )
    INSERT INTO deliveries (
      event_id,
      endpoint_id,
      seq,
      state,
      attempt_count,
      next_attempt_at
    )
    SELECT
      $2,
      u.endpoint_id,
      u.seq,
      'PENDING',
      0,
      now()
    FROM updated_endpoints u
    RETURNING *
  `;

  const queryFn = client ? (text, params) => client.query(text, params) : query;

  try {
    const result = await queryFn(sql, [tenantId, eventId]);
    return result.rows.map(mapRowToDelivery);
  } catch (error) {
    logger.error('Failed to batch enqueue deliveries', {
      error: error.message,
      tenantId,
      eventId,
    });
    throw error;
  }
}

// ============ DeliveryQueries Implementation ============

/**
 * Find deliveries by event ID.
 */
export async function findByEvent(eventId) {
  const sql = `
    SELECT id, event_id, endpoint_id, seq, state, attempt_count, next_attempt_at, lease_until, last_error, created_at, updated_at
    FROM deliveries
    WHERE event_id = $1
    ORDER BY seq
  `;

  try {
    const result = await query(sql, [eventId]);
    return result.rows.map(row => createDelivery({
      id: row.id,
      eventId: row.event_id,
      endpointId: row.endpoint_id,
      seq: row.seq,
      state: row.state,
      attemptCount: row.attempt_count,
      nextAttemptAt: row.next_attempt_at.toISOString(),
      leaseUntil: row.lease_until ? row.lease_until.toISOString() : null,
      lastError: row.last_error,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    }));
  } catch (error) {
    logger.error('Failed to find deliveries by event', { error: error.message });
    throw error;
  }
}

/**
 * Find deliveries by state.
 */
export async function findByState(state, limit) {
  const sql = `
    SELECT id, event_id, endpoint_id, seq, state, attempt_count, next_attempt_at, lease_until, last_error, created_at, updated_at
    FROM deliveries
    WHERE state = $1
    ORDER BY created_at DESC
    LIMIT $2
  `;

  try {
    const result = await query(sql, [state, limit]);
    return result.rows.map(row => createDelivery({
      id: row.id,
      eventId: row.event_id,
      endpointId: row.endpoint_id,
      seq: row.seq,
      state: row.state,
      attemptCount: row.attempt_count,
      nextAttemptAt: row.next_attempt_at.toISOString(),
      leaseUntil: row.lease_until ? row.lease_until.toISOString() : null,
      lastError: row.last_error,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    }));
  } catch (error) {
    logger.error('Failed to find deliveries by state', { error: error.message });
    throw error;
  }
}

// ============ DeliveryOutcomeRecorder Implementation ============

/**
 * Record a delivery attempt.
 */
export async function recordAttempt(attempt) {
  const sql = `
    INSERT INTO delivery_attempts (delivery_id, attempt_no, started_at, status_code, latency_ms, error)
    VALUES ($1, $2, $3, $4, $5, $6)
  `;

  try {
    await query(sql, [
      attempt.deliveryId,
      attempt.attemptNo,
      attempt.startedAt,
      attempt.statusCode,
      attempt.latencyMs,
      attempt.error,
    ]);
  } catch (error) {
    logger.error('Failed to record delivery attempt', { error: error.message });
    throw error;
  }
}

/**
 * Update delivery state.
 */
export async function updateState(deliveryId, state, nextAttemptAt, lastError) {
  const sql = `
    UPDATE deliveries
    SET state = $1, next_attempt_at = $2, last_error = $3, updated_at = now()
    WHERE id = $4
  `;

  try {
    await query(sql, [state, nextAttemptAt, lastError, deliveryId]);
  } catch (error) {
    logger.error('Failed to update delivery state', { error: error.message });
    throw error;
  }
}

export default {
  // EventRepository
  insert,
  findByTenantAndIdempotencyKey,
  findById,
  findAllByTenant,
  // DeliveryEnqueuer
  enqueue,
  enqueueBatch,
};
