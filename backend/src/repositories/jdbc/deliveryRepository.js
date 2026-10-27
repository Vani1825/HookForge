/**
 * JdbcDeliveryRepository - PostgreSQL adapter for delivery ports.
 * Implements DeliveryRepository, DeliveryQueries, and DeliveryOutcomeRecorder ports.
 */

import { query, getClient } from '../../config/database.js';
import { createDelivery } from '../../domain/models/delivery.js';
import { deliveryState } from '../../domain/deliveryState.js';
import logger from '../../utils/logger.js';

// Row mapper for Delivery domain model
function mapRowToDelivery(row) {
  return createDelivery({
    id: row.id,
    eventId: row.event_id,
    endpointId: row.endpoint_id,
    seq: row.seq,
    state: row.state,
    attemptCount: row.attempt_count,
    nextAttemptAt: row.next_attempt_at ? row.next_attempt_at.toISOString() : null,
    leaseUntil: row.lease_until ? row.lease_until.toISOString() : null,
    lastError: row.last_error,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  });
}

// ============ DeliveryRepository Implementation ============

/**
 * Insert a new delivery.
 */
export async function insert(eventId, endpointId, seq) {
  const sql = `
    INSERT INTO deliveries (event_id, endpoint_id, seq, state, attempt_count, next_attempt_at)
    VALUES ($1, $2, $3, 'PENDING', 0, now())
    RETURNING *
  `;

  try {
    const result = await query(sql, [eventId, endpointId, seq]);
    return mapRowToDelivery(result.rows[0]);
  } catch (error) {
    logger.error('Failed to insert delivery', { error: error.message });
    throw error;
  }
}

/**
 * Claim the next due delivery for an endpoint using FOR UPDATE SKIP LOCKED.
 * This implements the worker/dispatcher pattern with PostgreSQL as the queue.
 * Only claims if there is no earlier open delivery for the endpoint (ordering guarantee).
 * @param {string} endpointId - Endpoint UUID
 * @param {number} leaseDurationMs - Lease duration in milliseconds
 * @returns {Promise<Object|null>} Claimed delivery or null if none available
 */
export async function claim(endpointId, leaseDurationMs) {
  const client = await getClient();
  
  try {
    await client.query('BEGIN');

    // Check if there's an earlier open delivery for this endpoint
    const orderingCheckSql = `
      SELECT seq
      FROM deliveries
      WHERE endpoint_id = $1
        AND state IN ('PENDING', 'RETRYING', 'IN_FLIGHT')
      ORDER BY seq ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;
    const orderingResult = await client.query(orderingCheckSql, [endpointId]);

    if (orderingResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    const minOpenSeq = orderingResult.rows[0].seq;

    // Claim the lowest-sequence non-terminal delivery that is due
    const claimSql = `
      UPDATE deliveries
      SET state = 'IN_FLIGHT',
          lease_until = now() + (make_interval(secs => $2 / 1000.0)),
          updated_at = now()
      WHERE id = (
        SELECT id
        FROM deliveries
        WHERE endpoint_id = $1
          AND state IN ('PENDING', 'RETRYING')
          AND seq = $3
          AND next_attempt_at <= now()
        ORDER BY next_attempt_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `;
    const claimResult = await client.query(claimSql, [endpointId, leaseDurationMs / 1000, minOpenSeq]);

    if (claimResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    await client.query('COMMIT');
    return mapRowToDelivery(claimResult.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Failed to claim delivery', { error: error.message, endpointId });
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Release a lease (transition back to PENDING or RETRYING).
 */
export async function releaseLease(deliveryId, nextState, nextAttemptAt, lastError) {
  const sql = `
    UPDATE deliveries
    SET state = $1,
        lease_until = NULL,
        next_attempt_at = $2,
        last_error = $3,
        attempt_count = CASE WHEN $1 = 'PENDING' THEN 0 ELSE attempt_count END,
        updated_at = now()
    WHERE id = $4
    RETURNING *
  `;

  try {
    const result = await query(sql, [
      nextState.toString(),
      nextAttemptAt,
      lastError,
      deliveryId,
    ]);
    if (result.rows.length === 0) {
      return null;
    }
    return mapRowToDelivery(result.rows[0]);
  } catch (error) {
    logger.error('Failed to release lease', { error: error.message, deliveryId });
    throw error;
  }
}

/**
 * Mark delivery as terminal (SUCCEEDED or DEAD).
 */
export async function markTerminal(deliveryId, terminalState) {
  const sql = `
    UPDATE deliveries
    SET state = $1,
        lease_until = NULL,
        updated_at = now()
    WHERE id = $2
    RETURNING *
  `;

  try {
    const result = await query(sql, [terminalState.toString(), deliveryId]);
    if (result.rows.length === 0) {
      return null;
    }
    return mapRowToDelivery(result.rows[0]);
  } catch (error) {
    logger.error('Failed to mark delivery as terminal', {
      error: error.message,
      deliveryId,
    });
    throw error;
  }
}

/**
 * Find delivery by ID.
 */
export async function findById(deliveryId) {
  const sql = `
    SELECT *
    FROM deliveries
    WHERE id = $1
  `;

  try {
    const result = await query(sql, [deliveryId]);
    if (result.rows.length === 0) {
      return null;
    }
    return mapRowToDelivery(result.rows[0]);
  } catch (error) {
    logger.error('Failed to find delivery by ID', {
      error: error.message,
      deliveryId,
    });
    throw error;
  }
}

/**
 * Find delivery by ID and tenant (tenant-scoped access).
 */
export async function findByIdAndTenant(deliveryId, tenantId) {
  const sql = `
    SELECT d.*
    FROM deliveries d
    JOIN endpoints e ON d.endpoint_id = e.id
    WHERE d.id = $1 AND e.tenant_id = $2
  `;

  try {
    const result = await query(sql, [deliveryId, tenantId]);
    if (result.rows.length === 0) {
      return null;
    }
    return mapRowToDelivery(result.rows[0]);
  } catch (error) {
    logger.error('Failed to find delivery by ID and tenant', {
      error: error.message,
      deliveryId,
      tenantId,
    });
    throw error;
  }
}

// ============ DeliveryQueries Implementation ============

/**
 * Find deliveries by event ID (tenant-scoped).
 */
export async function findByEvent(eventId, tenantId) {
  const sql = `
    SELECT d.*
    FROM deliveries d
    JOIN endpoints e ON d.endpoint_id = e.id
    WHERE d.event_id = $1 AND e.tenant_id = $2
    ORDER BY d.seq ASC
  `;

  try {
    const result = await query(sql, [eventId, tenantId]);
    return result.rows.map(mapRowToDelivery);
  } catch (error) {
    logger.error('Failed to find deliveries by event', {
      error: error.message,
      eventId,
      tenantId,
    });
    throw error;
  }
}

/**
 * Find deliveries by state (tenant-scoped).
 */
export async function findByState(state, tenantId, limit = 100) {
  const sql = `
    SELECT d.*
    FROM deliveries d
    JOIN endpoints e ON d.endpoint_id = e.id
    WHERE d.state = $1 AND e.tenant_id = $2
    ORDER BY d.created_at DESC
    LIMIT $3
  `;

  try {
    const result = await query(sql, [state.toString(), tenantId, limit]);
    return result.rows.map(mapRowToDelivery);
  } catch (error) {
    logger.error('Failed to find deliveries by state', {
      error: error.message,
      state,
      tenantId,
    });
    throw error;
  }
}

/**
 * Find all deliveries for a tenant across all states.
 */
export async function findAllByTenant(tenantId, limit = 100) {
  const sql = `
    SELECT d.*
    FROM deliveries d
    JOIN endpoints e ON d.endpoint_id = e.id
    WHERE e.tenant_id = $1
    ORDER BY d.created_at DESC
    LIMIT $2
  `;

  try {
    const result = await query(sql, [tenantId, limit]);
    return result.rows.map(mapRowToDelivery);
  } catch (error) {
    logger.error('Failed to find all deliveries for tenant', {
      error: error.message,
      tenantId,
    });
    throw error;
  }
}

/**
 * Find all attempts for a given delivery.
 */
export async function findAttemptsByDeliveryId(deliveryId) {
  const sql = `
    SELECT id, delivery_id, attempt_no, started_at, status_code, latency_ms, error
    FROM delivery_attempts
    WHERE delivery_id = $1
    ORDER BY attempt_no ASC
  `;

  try {
    const result = await query(sql, [deliveryId]);
    return result.rows.map((row) => ({
      id: row.id,
      deliveryId: row.delivery_id,
      delivery_id: row.delivery_id,
      attemptNo: row.attempt_no,
      attempt_no: row.attempt_no,
      startedAt: row.started_at ? row.started_at.toISOString() : null,
      started_at: row.started_at ? row.started_at.toISOString() : null,
      statusCode: row.status_code,
      status_code: row.status_code,
      latencyMs: Number(row.latency_ms),
      latency_ms: Number(row.latency_ms),
      error: row.error,
    }));
  } catch (error) {
    logger.error('Failed to find attempts by delivery ID', {
      error: error.message,
      deliveryId,
    });
    throw error;
  }
}

/**
 * Find expired IN_FLIGHT deliveries for lease reaper.
 */
export async function findExpiredLeases(now) {
  const sql = `
    SELECT *
    FROM deliveries
    WHERE state = 'IN_FLIGHT'
      AND lease_until < $1
    ORDER BY lease_until ASC
  `;

  try {
    const result = await query(sql, [new Date(now)]);
    return result.rows.map(mapRowToDelivery);
  } catch (error) {
    logger.error('Failed to find expired leases', { error: error.message });
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
    logger.error('Failed to record delivery attempt', {
      error: error.message,
      deliveryId: attempt.deliveryId,
    });
    throw error;
  }
}

/**
 * Increment attempt count on delivery.
 */
export async function incrementAttemptCount(deliveryId) {
  const sql = `
    UPDATE deliveries
    SET attempt_count = attempt_count + 1,
        updated_at = now()
    WHERE id = $1
  `;

  try {
    await query(sql, [deliveryId]);
  } catch (error) {
    logger.error('Failed to increment attempt count', {
      error: error.message,
      deliveryId,
    });
    throw error;
  }
}

export default {
  // DeliveryRepository
  insert,
  claim,
  releaseLease,
  markTerminal,
  findById,
  findByIdAndTenant,
  // DeliveryQueries
  findByEvent,
  findByState,
  findAllByTenant,
  findAttemptsByDeliveryId,
  findExpiredLeases,
  // DeliveryOutcomeRecorder
  recordAttempt,
  incrementAttemptCount,
};
