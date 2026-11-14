/**
 * JdbcDeliveryRepository - PostgreSQL adapter for delivery ports.
 * Implements DeliveryRepository, DeliveryQueries, and DeliveryOutcomeRecorder ports.
 */

import { query, getClient } from '../../config/database.js';
import { createDelivery } from '../../domain/models/delivery.js';
import { findDueEndpoints } from './endpointRepository.js';
import { enqueueBatch } from './eventRepository.js';
import logger from '../../utils/logger.js';

export { findDueEndpoints, enqueueBatch };

// Row mapper for Delivery domain model
function mapRowToDelivery(row) {
  return createDelivery({
    id: row.id,
    eventId: row.event_id,
    endpointId: row.endpoint_id,
    endpointUrl: row.endpoint_url || null,
    lastStatusCode: row.last_status_code !== undefined ? row.last_status_code : null,
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
export async function insert(eventId, endpointId, seq, client = null) {
  const sql = `
    INSERT INTO deliveries (event_id, endpoint_id, seq, state, attempt_count, next_attempt_at)
    VALUES ($1, $2, $3, 'PENDING', 0, now())
    RETURNING *
  `;

  const queryFn = client ? (text, params) => client.query(text, params) : query;

  try {
    const result = await queryFn(sql, [eventId, endpointId, seq]);
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
 * Supports atomic attempt increment and stale-worker protection with attempt-level fencing.
 *
 * @param {string} deliveryId - Delivery UUID
 * @param {string|Object} nextState - Target state (PENDING or RETRYING)
 * @param {string} nextAttemptAt - ISO timestamp for next attempt
 * @param {string} lastError - Error message
 * @param {Object} [options={}] - Optional execution flags
 * @param {boolean} [options.incrementAttempt=false] - Atomically increment attempt_count in the same update
 * @param {boolean} [options.requireInFlight=false] - Stale worker protection: require IN_FLIGHT and active lease
 * @param {number|null} [options.expectedAttemptCount=null] - Fencing: require exact attempt_count to prevent reassignment races
 * @returns {Promise<Object|null>} Updated delivery domain model or null if stale/not found
 */
export async function releaseLease(deliveryId, nextState, nextAttemptAt, lastError, options = {}) {
  const {
    incrementAttempt = false,
    requireInFlight = false,
    expectedAttemptCount = null,
  } = options;
  const stateStr = nextState.toString();

  const attemptExpr =
    stateStr === 'PENDING'
      ? '0'
      : incrementAttempt
        ? 'attempt_count + 1'
        : 'attempt_count';

  let staleCondition = '';
  const params = [stateStr, nextAttemptAt, lastError, deliveryId];

  if (requireInFlight) {
    staleCondition += " AND state = 'IN_FLIGHT' AND lease_until IS NOT NULL AND lease_until >= now()";
  }

  if (expectedAttemptCount !== null && expectedAttemptCount !== undefined) {
    params.push(expectedAttemptCount);
    staleCondition += ` AND attempt_count = $${params.length}`;
  }

  const sql = `
    UPDATE deliveries
    SET state = $1,
        lease_until = NULL,
        next_attempt_at = $2,
        last_error = $3,
        attempt_count = ${attemptExpr},
        updated_at = now()
    WHERE id = $4${staleCondition}
    RETURNING *
  `;

  try {
    const result = await query(sql, params);
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
 * Supports atomic attempt increment and stale-worker protection with attempt-level fencing.
 *
 * @param {string} deliveryId - Delivery UUID
 * @param {string|Object} terminalState - Target terminal state (SUCCEEDED or DEAD)
 * @param {Object} [options={}] - Optional execution flags
 * @param {boolean} [options.incrementAttempt=false] - Atomically increment attempt_count in the same update
 * @param {boolean} [options.requireInFlight=false] - Stale worker protection: require IN_FLIGHT and active lease
 * @param {number|null} [options.expectedAttemptCount=null] - Fencing: require exact attempt_count to prevent reassignment races
 * @returns {Promise<Object|null>} Updated delivery domain model or null if stale/not found
 */
export async function markTerminal(deliveryId, terminalState, options = {}) {
  const {
    incrementAttempt = false,
    requireInFlight = false,
    expectedAttemptCount = null,
  } = options;
  const stateStr = terminalState.toString();

  const attemptExpr = incrementAttempt ? 'attempt_count + 1' : 'attempt_count';

  let staleCondition = '';
  const params = [stateStr, deliveryId];

  if (requireInFlight) {
    staleCondition += " AND state = 'IN_FLIGHT' AND lease_until IS NOT NULL AND lease_until >= now()";
  }

  if (expectedAttemptCount !== null && expectedAttemptCount !== undefined) {
    params.push(expectedAttemptCount);
    staleCondition += ` AND attempt_count = $${params.length}`;
  }

  const sql = `
    UPDATE deliveries
    SET state = $1,
        lease_until = NULL,
        attempt_count = ${attemptExpr},
        updated_at = now()
    WHERE id = $2${staleCondition}
    RETURNING *
  `;

  try {
    const result = await query(sql, params);
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
    WITH target_delivery AS (
      SELECT
        d.*,
        e.url AS endpoint_url
      FROM deliveries d
      LEFT JOIN endpoints e ON d.endpoint_id = e.id
      WHERE d.id = $1
      LIMIT 1
    ),
    latest_attempt AS (
      SELECT DISTINCT ON (a.delivery_id)
        a.delivery_id,
        a.status_code
      FROM delivery_attempts a
      JOIN target_delivery td ON a.delivery_id = td.id
      ORDER BY a.delivery_id, a.attempt_no DESC
    )
    SELECT
      td.*,
      la.status_code AS last_status_code
    FROM target_delivery td
    LEFT JOIN latest_attempt la ON td.id = la.delivery_id
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
    WITH target_delivery AS (
      SELECT
        d.*,
        e.url AS endpoint_url
      FROM deliveries d
      JOIN endpoints e ON d.endpoint_id = e.id
      WHERE d.id = $1 AND e.tenant_id = $2
      LIMIT 1
    ),
    latest_attempt AS (
      SELECT DISTINCT ON (a.delivery_id)
        a.delivery_id,
        a.status_code
      FROM delivery_attempts a
      JOIN target_delivery td ON a.delivery_id = td.id
      ORDER BY a.delivery_id, a.attempt_no DESC
    )
    SELECT
      td.*,
      la.status_code AS last_status_code
    FROM target_delivery td
    LEFT JOIN latest_attempt la ON td.id = la.delivery_id
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
    WITH filtered_deliveries AS (
      SELECT
        d.*,
        e.url AS endpoint_url
      FROM deliveries d
      JOIN endpoints e ON d.endpoint_id = e.id
      WHERE d.event_id = $1 AND e.tenant_id = $2
      ORDER BY d.seq ASC
    ),
    latest_attempts AS (
      SELECT DISTINCT ON (a.delivery_id)
        a.delivery_id,
        a.status_code
      FROM delivery_attempts a
      JOIN filtered_deliveries fd ON a.delivery_id = fd.id
      ORDER BY a.delivery_id, a.attempt_no DESC
    )
    SELECT
      fd.*,
      la.status_code AS last_status_code
    FROM filtered_deliveries fd
    LEFT JOIN latest_attempts la ON fd.id = la.delivery_id
    ORDER BY fd.seq ASC
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
export async function findByState(state, tenantId, limit = 100, options = {}) {
  const offset = typeof options === 'number' ? options : (options.offset || 0);
  const endpointId = typeof options === 'object' ? (options.endpointId || options.endpoint_id || null) : null;
  const params = [state.toString(), tenantId, limit];
  let endpointFilter = '';
  if (endpointId) {
    params.push(endpointId);
    endpointFilter = ` AND d.endpoint_id = $${params.length}`;
  }
  let offsetClause = '';
  if (offset > 0) {
    params.push(offset);
    offsetClause = ` OFFSET $${params.length}`;
  }

  const sql = `
    WITH filtered_deliveries AS (
      SELECT
        d.*,
        e.url AS endpoint_url
      FROM deliveries d
      JOIN endpoints e ON d.endpoint_id = e.id
      WHERE d.state = $1 AND e.tenant_id = $2${endpointFilter}
      ORDER BY d.created_at DESC
      LIMIT $3${offsetClause}
    ),
    latest_attempts AS (
      SELECT DISTINCT ON (a.delivery_id)
        a.delivery_id,
        a.status_code
      FROM delivery_attempts a
      JOIN filtered_deliveries fd ON a.delivery_id = fd.id
      ORDER BY a.delivery_id, a.attempt_no DESC
    )
    SELECT
      fd.*,
      la.status_code AS last_status_code
    FROM filtered_deliveries fd
    LEFT JOIN latest_attempts la ON fd.id = la.delivery_id
    ORDER BY fd.created_at DESC
  `;

  try {
    const result = await query(sql, params);
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
export async function findAllByTenant(tenantId, limit = 100, options = {}) {
  const offset = typeof options === 'number' ? options : (options.offset || 0);
  const endpointId = typeof options === 'object' ? (options.endpointId || options.endpoint_id || null) : null;
  const params = [tenantId, limit];
  let endpointFilter = '';
  if (endpointId) {
    params.push(endpointId);
    endpointFilter = ` AND d.endpoint_id = $${params.length}`;
  }
  let offsetClause = '';
  if (offset > 0) {
    params.push(offset);
    offsetClause = ` OFFSET $${params.length}`;
  }

  const sql = `
    WITH filtered_deliveries AS (
      SELECT
        d.*,
        e.url AS endpoint_url
      FROM deliveries d
      JOIN endpoints e ON d.endpoint_id = e.id
      WHERE e.tenant_id = $1${endpointFilter}
      ORDER BY d.created_at DESC
      LIMIT $2${offsetClause}
    ),
    latest_attempts AS (
      SELECT DISTINCT ON (a.delivery_id)
        a.delivery_id,
        a.status_code
      FROM delivery_attempts a
      JOIN filtered_deliveries fd ON a.delivery_id = fd.id
      ORDER BY a.delivery_id, a.attempt_no DESC
    )
    SELECT
      fd.*,
      la.status_code AS last_status_code
    FROM filtered_deliveries fd
    LEFT JOIN latest_attempts la ON fd.id = la.delivery_id
    ORDER BY fd.created_at DESC
  `;

  try {
    const result = await query(sql, params);
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
 * Find deliveries with flexible filtering, pagination, and sorting (tenant-scoped).
 *
 * @param {string} tenantId - Tenant UUID
 * @param {Object} [options]
 * @param {string} [options.state] - State filter (e.g. 'DEAD', 'SUCCEEDED', 'ALL')
 * @param {string} [options.endpointId] - Endpoint UUID filter
 * @param {string} [options.eventId] - Event UUID filter
 * @param {string} [options.search] - Search term for ID, URL, or error
 * @param {number} [options.limit=100] - Limit of rows
 * @param {number} [options.offset=0] - Offset for pagination
 * @param {string} [options.sortBy='created_at'] - Column to sort by
 * @param {'ASC'|'DESC'} [options.sortOrder='DESC'] - Sort direction
 * @returns {Promise<Array>} Array of mapped Delivery objects
 */
export async function findDeliveries(tenantId, options = {}) {
  const {
    state = null,
    endpointId = options.endpoint_id || null,
    eventId = options.event_id || null,
    search = null,
    limit = 100,
    offset = 0,
    sortBy = 'created_at',
    sortOrder = 'DESC',
  } = options;

  const validSortCols = {
    created_at: 'd.created_at',
    createdAt: 'd.created_at',
    seq: 'd.seq',
    updated_at: 'd.updated_at',
    updatedAt: 'd.updated_at',
  };
  const sortCol = validSortCols[sortBy] || 'd.created_at';
  const orderDir = String(sortOrder).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  const params = [tenantId];
  const conditions = ['e.tenant_id = $1'];

  if (state && state !== 'ALL') {
    params.push(state.toString());
    conditions.push(`d.state = $${params.length}`);
  }

  if (endpointId) {
    params.push(endpointId);
    conditions.push(`d.endpoint_id = $${params.length}`);
  }

  if (eventId) {
    params.push(eventId);
    conditions.push(`d.event_id = $${params.length}`);
  }

  if (search && search.trim()) {
    params.push(`%${search.trim()}%`);
    const searchIdx = params.length;
    conditions.push(`(d.id::text ILIKE $${searchIdx} OR e.url ILIKE $${searchIdx} OR d.last_error ILIKE $${searchIdx})`);
  }

  params.push(limit);
  const limitIdx = params.length;

  let offsetClause = '';
  if (offset > 0) {
    params.push(offset);
    offsetClause = ` OFFSET $${params.length}`;
  }

  const sql = `
    WITH filtered_deliveries AS (
      SELECT
        d.*,
        e.url AS endpoint_url
      FROM deliveries d
      JOIN endpoints e ON d.endpoint_id = e.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY ${sortCol} ${orderDir}
      LIMIT $${limitIdx}${offsetClause}
    ),
    latest_attempts AS (
      SELECT DISTINCT ON (a.delivery_id)
        a.delivery_id,
        a.status_code
      FROM delivery_attempts a
      JOIN filtered_deliveries fd ON a.delivery_id = fd.id
      ORDER BY a.delivery_id, a.attempt_no DESC
    )
    SELECT
      fd.*,
      la.status_code AS last_status_code
    FROM filtered_deliveries fd
    LEFT JOIN latest_attempts la ON fd.id = la.delivery_id
    ORDER BY ${sortCol.replace('d.', 'fd.')} ${orderDir}
  `;

  try {
    const result = await query(sql, params);
    return result.rows.map(mapRowToDelivery);
  } catch (error) {
    logger.error('Failed to find deliveries', {
      error: error.message,
      tenantId,
      options,
    });
    throw error;
  }
}

/**
 * Count deliveries matching criteria (tenant-scoped).
 *
 * @param {string} tenantId - Tenant UUID
 * @param {Object} [options]
 * @returns {Promise<number>} Total count of matching deliveries
 */
export async function countDeliveries(tenantId, options = {}) {
  const {
    state = null,
    endpointId = options.endpoint_id || null,
    eventId = options.event_id || null,
    search = null,
  } = options;

  const params = [tenantId];
  const conditions = ['e.tenant_id = $1'];

  if (state && state !== 'ALL') {
    params.push(state.toString());
    conditions.push(`d.state = $${params.length}`);
  }

  if (endpointId) {
    params.push(endpointId);
    conditions.push(`d.endpoint_id = $${params.length}`);
  }

  if (eventId) {
    params.push(eventId);
    conditions.push(`d.event_id = $${params.length}`);
  }

  if (search && search.trim()) {
    params.push(`%${search.trim()}%`);
    const searchIdx = params.length;
    conditions.push(`(d.id::text ILIKE $${searchIdx} OR e.url ILIKE $${searchIdx} OR d.last_error ILIKE $${searchIdx})`);
  }

  const sql = `
    SELECT COUNT(*)::bigint AS count
    FROM deliveries d
    JOIN endpoints e ON d.endpoint_id = e.id
    WHERE ${conditions.join(' AND ')}
  `;

  try {
    const result = await query(sql, params);
    return Number(result.rows[0]?.count || 0);
  } catch (error) {
    logger.error('Failed to count deliveries', {
      error: error.message,
      tenantId,
      options,
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

/**
 * Atomically recover a batch of expired IN_FLIGHT leases using a single set-based UPDATE.
 * Uses FOR UPDATE SKIP LOCKED to prevent concurrent recovery contention.
 * Transitions expired deliveries to DEAD if retry limit exceeded, otherwise RETRYING.
 *
 * @param {number|Date} now - Current timestamp
 * @param {number} [batchSize=100] - Maximum number of expired leases to recover
 * @param {number} [maxAttempts=8] - Maximum retry attempts before dead-lettering
 * @returns {Promise<Array<Object>>} List of recovered delivery summaries
 */
export async function recoverExpiredLeasesBatch(now, batchSize = 100, maxAttempts = 8) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const sql = `
    WITH expired_candidates AS (
      SELECT id
      FROM deliveries
      WHERE state = 'IN_FLIGHT'
        AND lease_until < $1
      ORDER BY lease_until ASC
      LIMIT $2
      FOR UPDATE SKIP LOCKED
    )
    UPDATE deliveries d
    SET state = CASE
          WHEN d.attempt_count + 1 >= $3 THEN 'DEAD'
          ELSE 'RETRYING'
        END,
        lease_until = NULL,
        next_attempt_at = CASE
          WHEN d.attempt_count + 1 >= $3 THEN d.next_attempt_at
          ELSE $1
        END,
        last_error = CASE
          WHEN d.attempt_count + 1 >= $3 THEN 'Lease expired - retry limit exceeded'
          ELSE 'Lease expired - worker crash recovery'
        END,
        attempt_count = d.attempt_count + 1,
        updated_at = now()
    FROM expired_candidates c
    WHERE d.id = c.id
    RETURNING d.id, d.endpoint_id, d.seq, d.state, d.attempt_count
  `;

  try {
    const result = await query(sql, [nowDate, batchSize, maxAttempts]);
    return result.rows.map(row => ({
      id: row.id,
      endpointId: row.endpoint_id,
      seq: row.seq,
      state: row.state,
      attemptCount: row.attempt_count,
    }));
  } catch (error) {
    logger.error('Failed to batch recover expired leases', { error: error.message });
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
  findDueEndpoints,
  enqueueBatch,
  releaseLease,
  markTerminal,
  findById,
  findByIdAndTenant,
  // DeliveryQueries
  findByEvent,
  findByState,
  findAllByTenant,
  findDeliveries,
  countDeliveries,
  findAttemptsByDeliveryId,
  findExpiredLeases,
  recoverExpiredLeasesBatch,
  // DeliveryOutcomeRecorder
  recordAttempt,
  incrementAttemptCount,
};
