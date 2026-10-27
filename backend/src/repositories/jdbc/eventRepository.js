/**
 * JdbcEventRepository - PostgreSQL adapter for EventRepository and DeliveryEnqueuer ports.
 * Implements event and delivery data access with transaction support.
 */

import { query, transaction } from '../../config/database.js';
import { createEvent } from '../../domain/models/event.js';
import { createDelivery } from '../../domain/models/delivery.js';
import { deliveryState } from '../../domain/deliveryState.js';
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

// ============ EventRepository Implementation ============

/**
 * Insert a new event with idempotency constraint.
 */
export async function insert(tenantId, payloadJson, idempotencyKey) {
  const sql = `
    INSERT INTO events (tenant_id, payload, idempotency_key)
    VALUES ($1, $2::jsonb, $3)
    RETURNING *
  `;

  try {
    const result = await query(sql, [tenantId, payloadJson, idempotencyKey]);
    return mapRowToEvent(result.rows[0]);
  } catch (error) {
    logger.error('Failed to insert event', { error: error.message });
    throw error;
  }
}

/**
 * Find event by tenant and idempotency key.
 */
export async function findByTenantAndIdempotencyKey(tenantId, idempotencyKey) {
  const sql = `
    SELECT *
    FROM events
    WHERE tenant_id = $1 AND idempotency_key = $2
  `;

  try {
    const result = await query(sql, [tenantId, idempotencyKey]);
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
export async function enqueue(eventId, endpointId, seq) {
  const sql = `
    INSERT INTO deliveries (event_id, endpoint_id, seq, state, attempt_count, next_attempt_at)
    VALUES ($1, $2, $3, 'PENDING', 0, now())
    RETURNING *
  `;

  try {
    const result = await query(sql, [eventId, endpointId, seq]);
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
};
