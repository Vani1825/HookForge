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
    scheduledAt: row.scheduled_at
      ? (row.scheduled_at instanceof Date ? row.scheduled_at.toISOString() : new Date(row.scheduled_at).toISOString())
      : null,
    nextAttemptAt: row.next_attempt_at
      ? (row.next_attempt_at instanceof Date ? row.next_attempt_at.toISOString() : new Date(row.next_attempt_at).toISOString())
      : null,
    leaseUntil: row.lease_until
      ? (row.lease_until instanceof Date ? row.lease_until.toISOString() : new Date(row.lease_until).toISOString())
      : null,
    lastError: row.last_error,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : new Date(row.updated_at).toISOString(),
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
          lease_until = now() + (make_interval(secs => $2)),
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

function escapeLikePattern(str) {
  return str.replace(/[%_\\]/g, '\\$&');
}

/**
 * Query deliveries with tenant isolation, dynamic filters, and pagination.
 *
 * @param {string} tenantId - Tenant UUID
 * @param {Object} filters - Filter criteria
 * @param {string} [filters.state] - State string or 'ALL'
 * @param {string} [filters.endpoint_id] - Endpoint UUID
 * @param {string} [filters.event_id] - Event UUID
 * @param {string} [filters.created_after] - ISO date string
 * @param {string} [filters.created_before] - ISO date string
 * @param {string} [filters.q] - Search query
 * @param {Object} pagination - Pagination parameters
 * @param {number} pagination.page - 1-based page number
 * @param {number} pagination.pageSize - Items per page
 * @returns {Promise<{ deliveries: Array, totalRecords: number }>}
 */
export async function findWithFilters(
  tenantId,
  filters = {},
  pagination = { page: 1, pageSize: 20 }
) {
  const conditions = ['e.tenant_id = $1'];
  const params = [tenantId];
  let paramIndex = 2;

  // 1. Delivery state / status (supports single state or array/comma-separated)
  const rawState = filters.state || filters.status;
  if (rawState && rawState !== 'ALL') {
    const states = Array.isArray(rawState)
      ? rawState.map((s) => String(s).trim().toUpperCase()).filter(Boolean)
      : String(rawState)
          .split(',')
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean);

    if (states.length === 1) {
      conditions.push(`d.state = $${paramIndex}`);
      params.push(states[0]);
      paramIndex++;
    } else if (states.length > 1) {
      conditions.push(`d.state = ANY($${paramIndex}::text[])`);
      params.push(states);
      paramIndex++;
    }
  }

  // 2. Endpoint ID filter (supports single UUID or array/comma-separated)
  const rawEndpointId = filters.endpoint_id || filters.endpointId;
  if (rawEndpointId) {
    const epIds = Array.isArray(rawEndpointId)
      ? rawEndpointId.map((id) => String(id).trim()).filter(Boolean)
      : String(rawEndpointId)
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean);

    if (epIds.length === 1) {
      conditions.push(`d.endpoint_id = $${paramIndex}`);
      params.push(epIds[0]);
      paramIndex++;
    } else if (epIds.length > 1) {
      conditions.push(`d.endpoint_id = ANY($${paramIndex}::uuid[])`);
      params.push(epIds);
      paramIndex++;
    }
  }

  // 3. Event ID filter (supports single UUID or array/comma-separated)
  const rawEventId = filters.event_id || filters.eventId;
  if (rawEventId) {
    const evIds = Array.isArray(rawEventId)
      ? rawEventId.map((id) => String(id).trim()).filter(Boolean)
      : String(rawEventId)
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean);

    if (evIds.length === 1) {
      conditions.push(`d.event_id = $${paramIndex}`);
      params.push(evIds[0]);
      paramIndex++;
    } else if (evIds.length > 1) {
      conditions.push(`d.event_id = ANY($${paramIndex}::uuid[])`);
      params.push(evIds);
      paramIndex++;
    }
  }

  // 4. Event Type filter (matches payload->>'type', payload->>'event', or payload->>'event_type')
  const rawEventType = filters.event_type || filters.eventType;
  if (rawEventType && String(rawEventType).trim()) {
    conditions.push(`(
      ev.payload->>'type' = $${paramIndex} OR
      ev.payload->>'event' = $${paramIndex} OR
      ev.payload->>'event_type' = $${paramIndex}
    )`);
    params.push(String(rawEventType).trim());
    paramIndex++;
  }

  // 5. Date range filters
  const createdAfter = filters.created_after || filters.from || filters.startDate || filters.start_date;
  if (createdAfter) {
    conditions.push(`d.created_at >= $${paramIndex}`);
    params.push(createdAfter);
    paramIndex++;
  }

  const createdBefore = filters.created_before || filters.to || filters.endDate || filters.end_date;
  if (createdBefore) {
    conditions.push(`d.created_at <= $${paramIndex}`);
    params.push(createdBefore);
    paramIndex++;
  }

  // 6. HTTP response status code filter (supports exact code e.g. 504, 200, 429 or class e.g. '5xx', '4xx', '2xx')
  const rawStatusCode =
    filters.status_code ??
    filters.statusCode ??
    filters.last_status_code ??
    filters.http_status;
  if (rawStatusCode !== undefined && rawStatusCode !== null && String(rawStatusCode).trim() !== '') {
    const codeStr = String(rawStatusCode).trim().toLowerCase();
    if (codeStr === '2xx') {
      conditions.push(`EXISTS (
        SELECT 1 FROM delivery_attempts da
        WHERE da.delivery_id = d.id AND da.status_code >= 200 AND da.status_code <= 299
      )`);
    } else if (codeStr === '3xx') {
      conditions.push(`EXISTS (
        SELECT 1 FROM delivery_attempts da
        WHERE da.delivery_id = d.id AND da.status_code >= 300 AND da.status_code <= 399
      )`);
    } else if (codeStr === '4xx') {
      conditions.push(`EXISTS (
        SELECT 1 FROM delivery_attempts da
        WHERE da.delivery_id = d.id AND da.status_code >= 400 AND da.status_code <= 499
      )`);
    } else if (codeStr === '5xx') {
      conditions.push(`EXISTS (
        SELECT 1 FROM delivery_attempts da
        WHERE da.delivery_id = d.id AND da.status_code >= 500 AND da.status_code <= 599
      )`);
    } else {
      const codeNum = parseInt(codeStr, 10);
      if (!isNaN(codeNum)) {
        conditions.push(`EXISTS (
          SELECT 1 FROM delivery_attempts da
          WHERE da.delivery_id = d.id AND da.status_code = $${paramIndex}
        )`);
        params.push(codeNum);
        paramIndex++;
      }
    }
  }

  // 7. Attempt count / Retry count filters
  const exactAttempts = filters.attempt_count ?? filters.attemptCount ?? filters.attempts;
  if (exactAttempts !== undefined && exactAttempts !== null && String(exactAttempts).trim() !== '') {
    const num = parseInt(String(exactAttempts), 10);
    if (!isNaN(num) && num >= 0) {
      conditions.push(`d.attempt_count = $${paramIndex}`);
      params.push(num);
      paramIndex++;
    }
  }

  const minAttempts = filters.min_attempts ?? filters.minAttempts;
  if (minAttempts !== undefined && minAttempts !== null && String(minAttempts).trim() !== '') {
    const num = parseInt(String(minAttempts), 10);
    if (!isNaN(num) && num >= 0) {
      conditions.push(`d.attempt_count >= $${paramIndex}`);
      params.push(num);
      paramIndex++;
    }
  }

  const maxAttempts = filters.max_attempts ?? filters.maxAttempts;
  if (maxAttempts !== undefined && maxAttempts !== null && String(maxAttempts).trim() !== '') {
    const num = parseInt(String(maxAttempts), 10);
    if (!isNaN(num) && num >= 0) {
      conditions.push(`d.attempt_count <= $${paramIndex}`);
      params.push(num);
      paramIndex++;
    }
  }

  // 8. Text search filter
  const searchQuery = filters.q || filters.search;
  if (searchQuery && searchQuery.trim()) {
    const pattern = `%${escapeLikePattern(searchQuery.trim())}%`;
    conditions.push(`(
      d.id::text ILIKE $${paramIndex} OR
      d.event_id::text ILIKE $${paramIndex} OR
      d.endpoint_id::text ILIKE $${paramIndex} OR
      (d.last_error IS NOT NULL AND d.last_error ILIKE $${paramIndex}) OR
      e.url ILIKE $${paramIndex} OR
      ev.idempotency_key ILIKE $${paramIndex} OR
      (ev.payload->>'type' IS NOT NULL AND ev.payload->>'type' ILIKE $${paramIndex}) OR
      (ev.payload->>'event' IS NOT NULL AND ev.payload->>'event' ILIKE $${paramIndex}) OR
      (ev.payload->>'event_type' IS NOT NULL AND ev.payload->>'event_type' ILIKE $${paramIndex})
    )`);
    params.push(pattern);
    paramIndex++;
  }

  const whereClause = conditions.join(' AND ');

  const countSql = `
    SELECT count(*)::int AS count
    FROM deliveries d
    JOIN endpoints e ON d.endpoint_id = e.id
    JOIN events ev ON d.event_id = ev.id
    WHERE ${whereClause}
  `;

  // Pagination parameters
  let limit = 20;
  if (pagination.pageSize !== undefined) {
    limit = Math.min(100, Math.max(1, parseInt(pagination.pageSize, 10)));
  } else if (pagination.limit !== undefined) {
    limit = Math.min(1000, Math.max(1, parseInt(pagination.limit, 10)));
  }

  let offset = 0;
  if (pagination.page !== undefined) {
    const page = Math.max(1, parseInt(pagination.page, 10));
    offset = (page - 1) * limit;
  } else if (pagination.offset !== undefined) {
    offset = Math.max(0, parseInt(pagination.offset, 10));
  }

  // Sorting columns
  const validSortCols = {
    created_at: 'd.created_at',
    createdAt: 'd.created_at',
    updated_at: 'd.updated_at',
    updatedAt: 'd.updated_at',
    seq: 'd.seq',
    attempt_count: 'd.attempt_count',
    attemptCount: 'd.attempt_count',
    next_attempt_at: 'd.next_attempt_at',
    nextAttemptAt: 'd.next_attempt_at',
  };

  const requestedSortBy = pagination.sortBy || pagination.sort_by || filters.sortBy || filters.sort_by;
  const sortCol = validSortCols[requestedSortBy] || 'd.created_at';

  const requestedSortOrder = pagination.sortOrder || pagination.sort_order || pagination.order || filters.sortOrder || filters.sort_order || filters.order;
  const orderDir = String(requestedSortOrder || '').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  const dataSql = `
    WITH filtered_deliveries AS (
      SELECT
        d.*,
        e.url AS endpoint_url
      FROM deliveries d
      JOIN endpoints e ON d.endpoint_id = e.id
      JOIN events ev ON d.event_id = ev.id
      WHERE ${whereClause}
      ORDER BY ${sortCol} ${orderDir}, d.id ${orderDir}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
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
    ORDER BY ${sortCol.replace('d.', 'fd.')} ${orderDir}, fd.id ${orderDir}
  `;

  const dataParams = [...params, limit, offset];

  try {
    const [countResult, dataResult] = await Promise.all([
      query(countSql, params),
      query(dataSql, dataParams),
    ]);

    const totalRecords = countResult.rows[0]?.count || 0;
    const deliveries = dataResult.rows.map(mapRowToDelivery);

    return {
      deliveries,
      totalRecords,
    };
  } catch (error) {
    logger.error('Failed to find deliveries with filters', {
      error: error.message,
      tenantId,
      filters,
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
    SELECT id, delivery_id, attempt_no, started_at, status_code, latency_ms, error,
           response_body, response_headers, request_headers
    FROM delivery_attempts
    WHERE delivery_id = $1
    ORDER BY attempt_no ASC, id ASC
  `;

  try {
    const result = await query(sql, [deliveryId]);
    return result.rows.map((row) => {
      const respHeaders = typeof row.response_headers === 'string'
        ? JSON.parse(row.response_headers)
        : (row.response_headers || null);
      const reqHeaders = typeof row.request_headers === 'string'
        ? JSON.parse(row.request_headers)
        : (row.request_headers || null);

      return {
        id: row.id,
        deliveryId: row.delivery_id,
        delivery_id: row.delivery_id,
        attemptNo: row.attempt_no,
        attempt_no: row.attempt_no,
        startedAt: row.started_at ? (row.started_at instanceof Date ? row.started_at.toISOString() : new Date(row.started_at).toISOString()) : null,
        started_at: row.started_at ? (row.started_at instanceof Date ? row.started_at.toISOString() : new Date(row.started_at).toISOString()) : null,
        statusCode: row.status_code,
        status_code: row.status_code,
        latencyMs: Number(row.latency_ms),
        latency_ms: Number(row.latency_ms),
        error: row.error,
        responseBody: row.response_body || null,
        response_body: row.response_body || null,
        responseHeaders: respHeaders,
        response_headers: respHeaders,
        requestHeaders: reqHeaders,
        request_headers: reqHeaders,
      };
    });
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
    INSERT INTO delivery_attempts (
      delivery_id, attempt_no, started_at, status_code, latency_ms, error,
      response_body, response_headers, request_headers
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `;

  const respBody = attempt.responseBody ?? attempt.response_body ?? null;
  const rawRespHeaders = attempt.responseHeaders ?? attempt.response_headers ?? null;
  const rawReqHeaders = attempt.requestHeaders ?? attempt.request_headers ?? null;

  const respHeaders = rawRespHeaders !== null && rawRespHeaders !== undefined
    ? (typeof rawRespHeaders === 'string' ? rawRespHeaders : JSON.stringify(rawRespHeaders))
    : null;

  const reqHeaders = rawReqHeaders !== null && rawReqHeaders !== undefined
    ? (typeof rawReqHeaders === 'string' ? rawReqHeaders : JSON.stringify(rawReqHeaders))
    : null;

  try {
    await query(sql, [
      attempt.deliveryId,
      attempt.attemptNo,
      attempt.startedAt,
      attempt.statusCode,
      attempt.latencyMs,
      attempt.error,
      respBody,
      respHeaders,
      reqHeaders,
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
 * Atomically claim a delivery for immediate resend execution, setting state to IN_FLIGHT
 * with an active lease. Rejects if already IN_FLIGHT.
 *
 * @param {string} deliveryId - Delivery UUID
 * @param {number} leaseDurationMs - Lease duration in milliseconds
 * @returns {Promise<Object|null>} Claimed delivery domain model or null
 */
export async function claimForImmediateExecution(deliveryId, leaseDurationMs) {
  const sql = `
    UPDATE deliveries
    SET state = 'IN_FLIGHT',
        lease_until = now() + (make_interval(secs => $2)),
        updated_at = now()
    WHERE id = $1
      AND state IN ('DEAD', 'SUCCEEDED', 'CANCELLED', 'PENDING', 'RETRYING')
    RETURNING *
  `;

  try {
    const result = await query(sql, [deliveryId, leaseDurationMs / 1000.0]);
    if (result.rows.length === 0) {
      return null;
    }
    return mapRowToDelivery(result.rows[0]);
  } catch (error) {
    logger.error('Failed to claim delivery for immediate execution', {
      error: error.message,
      deliveryId,
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

/**
 * Insert a new scheduled delivery.
 */
export async function insertScheduledDelivery(eventId, endpointId, seq, scheduledAt, client = null) {
  const sql = `
    INSERT INTO deliveries (
      event_id,
      endpoint_id,
      seq,
      state,
      attempt_count,
      scheduled_at,
      next_attempt_at
    )
    VALUES ($1, $2, $3, 'SCHEDULED', 0, $4, $4)
    RETURNING *
  `;

  const queryFn = client ? (text, params) => client.query(text, params) : query;

  try {
    const result = await queryFn(sql, [eventId, endpointId, seq, scheduledAt]);
    return mapRowToDelivery(result.rows[0]);
  } catch (error) {
    logger.error('Failed to insert scheduled delivery', {
      error: error.message,
      endpointId,
      eventId,
      scheduledAt,
    });
    throw error;
  }
}

/**
 * Cancel a delivery (tenant-scoped).
 * Can only cancel deliveries in SCHEDULED or PENDING state.
 */
export async function cancelDelivery(deliveryId, tenantId) {
  const sql = `
    UPDATE deliveries d
    SET state = 'CANCELLED',
        updated_at = now()
    FROM endpoints e
    WHERE d.id = $1
      AND d.endpoint_id = e.id
      AND e.tenant_id = $2
      AND d.state IN ('SCHEDULED', 'PENDING')
    RETURNING d.*, e.url AS endpoint_url
  `;

  try {
    const result = await query(sql, [deliveryId, tenantId]);
    if (result.rows.length === 0) {
      return null;
    }
    return mapRowToDelivery(result.rows[0]);
  } catch (error) {
    logger.error('Failed to cancel delivery', {
      error: error.message,
      deliveryId,
      tenantId,
    });
    throw error;
  }
}

/**
 * Promote due scheduled deliveries to PENDING.
 * Safely claims and promotes up to batchSize deliveries whose scheduled time has arrived.
 */
export async function promoteDueScheduled(batchSize = 100) {
  const sql = `
    WITH due_scheduled AS (
      SELECT id
      FROM deliveries
      WHERE state = 'SCHEDULED'
        AND next_attempt_at <= now()
      ORDER BY next_attempt_at ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE deliveries d
    SET state = 'PENDING',
        updated_at = now()
    FROM due_scheduled s
    WHERE d.id = s.id
    RETURNING d.id
  `;

  try {
    const result = await query(sql, [batchSize]);
    return result.rows.length;
  } catch (error) {
    logger.error('Failed to promote due scheduled deliveries', {
      error: error.message,
    });
    throw error;
  }
}

export default {
  // DeliveryRepository
  insert,
  insertScheduledDelivery,
  cancelDelivery,
  promoteDueScheduled,
  claim,
  claimForImmediateExecution,
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
  findWithFilters,
  findAttemptsByDeliveryId,
  findExpiredLeases,
  recoverExpiredLeasesBatch,
  // DeliveryOutcomeRecorder
  recordAttempt,
  incrementAttemptCount,
};
