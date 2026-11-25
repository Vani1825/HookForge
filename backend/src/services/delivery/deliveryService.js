/**
 * DeliveryService - Service layer for delivery status and replay operations.
 * Handles tenant-scoped queries and replay state transitions.
 */

import deliveryRepository from '../../repositories/jdbc/deliveryRepository.js';
import endpointRepository from '../../repositories/jdbc/endpointRepository.js';
import eventRepository from '../../repositories/jdbc/eventRepository.js';
import { transaction } from '../../config/database.js';
import { v4 as uuidv4 } from 'uuid';
import { deliveryState } from '../../domain/deliveryState.js';
import { IllegalStateTransitionError } from '../../domain/errors/illegalStateTransitionError.js';
import logger from '../../utils/logger.js';
import {
  redactSensitiveData,
  sanitizeErrorMessage,
  sanitizeUrl,
  classifyFailure,
  getFailureRecommendation,
} from '../../utils/redaction.js';

/**
 * Get deliveries for an event (tenant-scoped).
 * @param {string} eventId - Event UUID
 * @param {string} tenantId - Tenant UUID for access control
 * @returns {Promise<Array>} Array of delivery objects
 */
export async function getDeliveriesByEvent(eventId, tenantId) {
  return await deliveryRepository.findByEvent(eventId, tenantId);
}

/**
 * Get deliveries by state (tenant-scoped).
 * @param {string} state - Delivery state string
 * @param {string} tenantId - Tenant UUID for access control
 * @param {number} limit - Max results
 * @param {Object} [options] - Additional pagination/filtering options
 * @returns {Promise<Array>} Array of delivery objects
 */
export async function getDeliveriesByState(state, tenantId, limit = 100, options = null) {
  const deliveryStateEnum = deliveryState.fromString(state);
  if (options && Object.keys(options).length > 0) {
    return await deliveryRepository.findByState(deliveryStateEnum, tenantId, limit, options);
  }
  return await deliveryRepository.findByState(deliveryStateEnum, tenantId, limit);
}

/**
 * Replay a DEAD delivery.
 * Only DEAD deliveries can be replayed.
 * Transitions DEAD -> PENDING and resets attempt count.
 * @param {string} deliveryId - Delivery UUID
 * @param {string} tenantId - Tenant UUID for access control
 * @returns {Promise<Object>} Updated delivery
 */
export async function replayDelivery(deliveryId, tenantId) {
  // Find delivery with tenant scope
  const delivery = await deliveryRepository.findByIdAndTenant(deliveryId, tenantId);
  
  if (!delivery) {
    const error = new Error('Delivery not found');
    error.statusCode = 404;
    throw error;
  }

  // Check if delivery is in DEAD state
  if (!delivery.state.equals(deliveryState.DEAD)) {
    throw new IllegalStateTransitionError(delivery.state.toString(), 'PENDING');
  }

  // Transition DEAD -> PENDING
  const updated = await deliveryRepository.releaseLease(
    deliveryId,
    deliveryState.PENDING,
    new Date().toISOString(),
    null // Clear last error
  );

  logger.info('Delivery replayed', {
    deliveryId,
    tenantId,
    endpointId: delivery.endpointId,
  });

  const replayed = { ...updated };
  if (delivery.endpointUrl !== undefined || updated?.endpointUrl !== undefined) {
    replayed.endpointUrl = updated?.endpointUrl || delivery.endpointUrl || null;
  }
  if (delivery.lastStatusCode !== undefined || updated?.lastStatusCode !== undefined) {
    replayed.lastStatusCode = updated?.lastStatusCode !== undefined ? updated.lastStatusCode : (delivery.lastStatusCode ?? null);
  }

  return replayed;
}

/**
 * Get all deliveries for a tenant across states.
 * @param {string} tenantId - Tenant UUID for access control
 * @param {number} limit - Max results
 * @param {Object} [options] - Additional pagination/filtering options
 * @returns {Promise<Array>} Array of delivery objects
 */
export async function getAllDeliveries(tenantId, limit = 100, options = null) {
  if (options && Object.keys(options).length > 0) {
    return await deliveryRepository.findAllByTenant(tenantId, limit, options);
  }
  return await deliveryRepository.findAllByTenant(tenantId, limit);
}

/**
 * Get deliveries with flexible filtering, pagination, and sorting (tenant-scoped).
 * @param {string} tenantId - Tenant UUID
 * @param {Object} [options]
 * @returns {Promise<Array>}
 */
export async function getDeliveries(tenantId, options = {}) {
  return await deliveryRepository.findDeliveries(tenantId, options);
}

/**
 * Count deliveries matching criteria (tenant-scoped).
 * @param {string} tenantId - Tenant UUID
 * @param {Object} [options]
 * @returns {Promise<number>}
 */
export async function countDeliveries(tenantId, options = {}) {
  return await deliveryRepository.countDeliveries(tenantId, options);
}

/**
 * Helper to format a detailed delivery payload with sanitized attempts,
 * redacted event payload, sanitized endpoint details, lifecycle metadata,
 * and actionable diagnostics.
 */
function formatDetailedDelivery(delivery, attempts = [], event = null, endpoint = null) {
  let eventPayload = null;
  let eventType = null;
  if (event) {
    try {
      const rawPayload =
        typeof event.payloadJson === 'string'
          ? JSON.parse(event.payloadJson)
          : event.payloadJson ||
            (typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload);
      eventPayload = redactSensitiveData(rawPayload);
      eventType =
        rawPayload?.type ||
        rawPayload?.event ||
        rawPayload?.event_type ||
        null;
    } catch {
      eventPayload = null;
    }
  }

  const endpointUrl = endpoint?.url || delivery.endpointUrl || null;
  const sanitizedUrl = sanitizeUrl(endpointUrl);

  const formattedAttempts = (attempts || []).map((a) => {
    const lat = Number(a.latencyMs || a.latency_ms || 0);
    const code = a.statusCode ?? a.status_code ?? null;
    const err = sanitizeErrorMessage(a.error);
    const summary = code
      ? `HTTP ${code}`
      : err
        ? err
        : 'No response';

    return {
      id: a.id,
      deliveryId: a.deliveryId || delivery.id,
      delivery_id: a.deliveryId || delivery.id,
      attemptNo: a.attemptNo ?? a.attempt_no,
      attempt_no: a.attemptNo ?? a.attempt_no,
      startedAt: a.startedAt || a.started_at,
      started_at: a.startedAt || a.started_at,
      statusCode: code,
      status_code: code,
      latencyMs: lat,
      latency_ms: lat,
      durationMs: lat,
      duration_ms: lat,
      error: err,
      responseSummary: summary,
      response_summary: summary,
      request: {
        method: 'POST',
        url: sanitizedUrl,
      },
    };
  });

  const failureCategory = classifyFailure(delivery.lastError, delivery.lastStatusCode);
  const recommendation = getFailureRecommendation(failureCategory, delivery.lastStatusCode);

  const maxAttempts = endpoint?.retryMaxAttempts || 8;
  const remainingAttempts = Math.max(0, maxAttempts - (delivery.attemptCount || 0));

  const createdTime = new Date(delivery.createdAt).getTime();
  const updatedTime = new Date(delivery.updatedAt).getTime();
  const lifecycleDurationMs =
    !isNaN(createdTime) && !isNaN(updatedTime) ? Math.max(0, updatedTime - createdTime) : 0;

  return {
    ...delivery,
    endpointUrl: sanitizedUrl,
    endpoint_url: sanitizedUrl,
    event: event
      ? {
          id: event.id,
          idempotencyKey: event.idempotencyKey || null,
          idempotency_key: event.idempotencyKey || null,
          eventType,
          event_type: eventType,
          createdAt: event.createdAt,
          created_at: event.createdAt,
          payload: eventPayload,
        }
      : null,
    endpoint: endpoint
      ? {
          id: endpoint.id,
          url: sanitizedUrl,
          active: endpoint.active,
          rateLimitRps: endpoint.rateLimitRps || 10,
          rate_limit_rps: endpoint.rateLimitRps || 10,
          circuitState: endpoint.circuitState || 'CLOSED',
          circuit_state: endpoint.circuitState || 'CLOSED',
          retryPolicy: {
            strategy: endpoint.retryStrategy || 'EXPONENTIAL',
            maxAttempts: endpoint.retryMaxAttempts || 8,
            baseDelayMs: endpoint.retryBaseDelayMs || 5000,
            maxDelayMs: endpoint.retryMaxDelayMs || 3600000,
            backoffMultiplier: endpoint.retryBackoffMultiplier
              ? Number(endpoint.retryBackoffMultiplier)
              : 2.0,
          },
        }
      : null,
    retry: {
      strategy: endpoint?.retryStrategy || 'EXPONENTIAL',
      maxAttempts,
      max_attempts: maxAttempts,
      attemptCount: delivery.attemptCount || 0,
      attempt_count: delivery.attemptCount || 0,
      remainingAttempts,
      remaining_attempts: remainingAttempts,
      nextAttemptAt: delivery.nextAttemptAt || null,
      next_attempt_at: delivery.nextAttemptAt || null,
      scheduledAt: delivery.scheduledAt || null,
      scheduled_at: delivery.scheduledAt || null,
      isRetryable: ['PENDING', 'RETRYING', 'DEAD'].includes(
        delivery.state?.toString() || delivery.state
      ),
      is_retryable: ['PENDING', 'RETRYING', 'DEAD'].includes(
        delivery.state?.toString() || delivery.state
      ),
    },
    lifecycle: {
      state: delivery.state?.toString() || delivery.state,
      isTerminal: ['SUCCEEDED', 'DEAD', 'CANCELLED'].includes(
        delivery.state?.toString() || delivery.state
      ),
      is_terminal: ['SUCCEEDED', 'DEAD', 'CANCELLED'].includes(
        delivery.state?.toString() || delivery.state
      ),
      createdAt: delivery.createdAt,
      created_at: delivery.createdAt,
      updatedAt: delivery.updatedAt,
      updated_at: delivery.updatedAt,
      scheduledAt: delivery.scheduledAt || null,
      scheduled_at: delivery.scheduledAt || null,
      nextAttemptAt: delivery.nextAttemptAt || null,
      next_attempt_at: delivery.nextAttemptAt || null,
      totalAttempts: delivery.attemptCount || 0,
      total_attempts: delivery.attemptCount || 0,
      durationMs: lifecycleDurationMs,
      duration_ms: lifecycleDurationMs,
    },
    request: {
      method: 'POST',
      url: sanitizedUrl,
      seq: delivery.seq,
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Id': delivery.id,
        'X-Webhook-Timestamp': '[TIMESTAMP]',
        'X-Webhook-Signature': '[REDACTED]',
      },
    },
    diagnostics: {
      lastError: sanitizeErrorMessage(delivery.lastError),
      last_error: sanitizeErrorMessage(delivery.lastError),
      failureCategory,
      failure_category: failureCategory,
      recommendation,
    },
    attempts: formattedAttempts,
  };
}

/**
 * Get delivery by ID with attempts, event payload, endpoint info, and diagnostics (tenant-scoped).
 * @param {string} deliveryId - Delivery UUID
 * @param {string} tenantId - Tenant UUID for access control
 * @returns {Promise<Object|null>} Detailed delivery object
 */
export async function getDeliveryById(deliveryId, tenantId) {
  const delivery = await deliveryRepository.findByIdAndTenant(deliveryId, tenantId);
  if (!delivery) return null;

  const [attempts, event, endpoint] = await Promise.all([
    deliveryRepository.findAttemptsByDeliveryId(deliveryId).catch(() => []),
    delivery.eventId ? eventRepository.findById(delivery.eventId).catch(() => null) : null,
    delivery.endpointId
      ? endpointRepository.findByIdAndTenant(delivery.endpointId, tenantId).catch(() => null)
      : null,
  ]);

  return formatDetailedDelivery(delivery, attempts || [], event, endpoint);
}

/**
 * Get attempt history for a delivery (tenant-scoped).
 * @param {string} deliveryId - Delivery UUID
 * @param {string} tenantId - Tenant UUID for access control
 * @returns {Promise<Array|null>} Array of sanitized attempt objects or null if not found
 */
export async function getDeliveryAttempts(deliveryId, tenantId) {
  const delivery = await deliveryRepository.findByIdAndTenant(deliveryId, tenantId);
  if (!delivery) return null;

  const [attempts, endpoint] = await Promise.all([
    deliveryRepository.findAttemptsByDeliveryId(deliveryId).catch(() => []),
    delivery.endpointId
      ? endpointRepository.findByIdAndTenant(delivery.endpointId, tenantId).catch(() => null)
      : null,
  ]);

  const sanitizedUrl = sanitizeUrl(endpoint?.url || delivery.endpointUrl || '');
  return (attempts || []).map((a) => {
    const lat = Number(a.latencyMs || a.latency_ms || 0);
    const code = a.statusCode ?? a.status_code ?? null;
    const err = sanitizeErrorMessage(a.error);
    const summary = code ? `HTTP ${code}` : err || 'No response';

    return {
      id: a.id,
      deliveryId: a.deliveryId || delivery.id,
      delivery_id: a.deliveryId || delivery.id,
      attemptNo: a.attemptNo ?? a.attempt_no,
      attempt_no: a.attemptNo ?? a.attempt_no,
      startedAt: a.startedAt || a.started_at,
      started_at: a.startedAt || a.started_at,
      statusCode: code,
      status_code: code,
      latencyMs: lat,
      latency_ms: lat,
      durationMs: lat,
      duration_ms: lat,
      error: err,
      responseSummary: summary,
      response_summary: summary,
      request: {
        method: 'POST',
        url: sanitizedUrl,
      },
    };
  });
}

/**
 * Get detailed diagnostic logs for a delivery (tenant-scoped).
 * @param {string} deliveryId - Delivery UUID
 * @param {string} tenantId - Tenant UUID for access control
 * @returns {Promise<Object|null>}
 */
export async function getDeliveryLogs(deliveryId, tenantId) {
  return await getDeliveryById(deliveryId, tenantId);
}

/**
 * Query deliveries with tenant isolation, dynamic filters, and pagination.
 *
 * @param {string} tenantId - Tenant UUID for access control
 * @param {Object} [filters={}] - Filter criteria (state, endpoint_id, event_id, created_after, created_before, q)
 * @param {Object} [pagination={}] - Pagination options (page, pageSize, limit, offset)
 * @returns {Promise<{ deliveries: Array, pagination: Object }>}
 */
export async function queryDeliveries(tenantId, filters = {}, pagination = {}) {
  // Precedence: pageSize > limit
  let limit = 20;
  if (pagination.pageSize !== undefined) {
    limit = Math.min(100, Math.max(1, parseInt(pagination.pageSize, 10)));
  } else if (pagination.limit !== undefined) {
    limit = Math.min(1000, Math.max(1, parseInt(pagination.limit, 10)));
  }

  // Precedence: page > offset
  let page = 1;
  let offset = 0;
  const offsetRequested = pagination.offset !== undefined && pagination.page === undefined;

  if (pagination.page !== undefined) {
    page = Math.max(1, parseInt(pagination.page, 10));
    offset = (page - 1) * limit;
  } else if (pagination.offset !== undefined) {
    offset = Math.max(0, parseInt(pagination.offset, 10));
    page = Math.floor(offset / limit) + 1;
  }

  const repoPagination = {
    page,
    pageSize: limit,
  };
  if (pagination.limit !== undefined && pagination.pageSize === undefined) {
    repoPagination.limit = limit;
  }
  if (pagination.offset !== undefined && pagination.page === undefined) {
    repoPagination.offset = offset;
  }

  const result = await deliveryRepository.findWithFilters(
    tenantId,
    filters,
    repoPagination
  );

  const totalRecords = result.totalRecords;
  const totalPages = totalRecords === 0 ? 0 : Math.ceil(totalRecords / limit);
  const hasNext = offset + limit < totalRecords;
  const hasPrev = totalRecords > 0 && offset > 0;

  const paginationMeta = {
    page,
    pageSize: limit,
    totalRecords,
    totalPages,
    hasNext,
    hasPrev,
    ...(offsetRequested ? { offset } : {}),
  };

  return {
    deliveries: result.deliveries,
    pagination: paginationMeta,
  };
}

/**
 * Schedule a webhook delivery for a future date and time.
 *
 * @param {string} tenantId - Tenant UUID for authorization
 * @param {Object} options - Scheduling parameters
 * @param {string} options.endpointId - Endpoint UUID
 * @param {string} options.scheduledAt - Future ISO 8601 execution timestamp
 * @param {string} [options.eventId] - Existing Event UUID
 * @param {Object|string} [options.payload] - Webhook payload object
 * @param {string} [options.idempotencyKey] - Idempotency key for event creation
 * @returns {Promise<Object>} Created delivery domain model
 */
export async function scheduleDelivery(tenantId, options = {}) {
  const endpointId = options.endpointId || options.endpoint_id;
  const scheduledAt = options.scheduledAt || options.scheduled_at;
  const eventId = options.eventId || options.event_id;
  const payload = options.payload;
  const idempotencyKey = options.idempotencyKey || options.idempotency_key;

  if (!endpointId) {
    const error = new Error('endpointId is required');
    error.statusCode = 400;
    throw error;
  }

  if (!scheduledAt) {
    const error = new Error('scheduledAt is required');
    error.statusCode = 400;
    throw error;
  }

  const scheduledDate = new Date(scheduledAt);
  const scheduledTime = scheduledDate.getTime();
  if (isNaN(scheduledTime)) {
    const error = new Error('scheduledAt must be a valid ISO 8601 date string');
    error.statusCode = 400;
    throw error;
  }

  if (scheduledTime <= Date.now()) {
    const error = new Error('scheduledAt must be a future date and time');
    error.statusCode = 400;
    throw error;
  }

  // Verify endpoint belongs to authenticated tenant
  const endpoint = await endpointRepository.findByIdAndTenant(endpointId, tenantId);
  if (!endpoint) {
    const error = new Error('Endpoint not found');
    error.statusCode = 404;
    throw error;
  }

  return await transaction(async (client) => {
    let resolvedEventId = eventId;

    if (!resolvedEventId) {
      if (payload === undefined || payload === null) {
        const error = new Error('Either eventId or payload must be provided');
        error.statusCode = 400;
        throw error;
      }

      if (
        typeof payload !== 'object' ||
        Array.isArray(payload) ||
        Object.keys(payload).length === 0
      ) {
        const error = new Error('Payload must be a non-empty JSON object');
        error.statusCode = 400;
        throw error;
      }

      const payloadJson = JSON.stringify(payload);
      const key = idempotencyKey || `sched_${uuidv4()}`;

      let event = await eventRepository.insert(tenantId, payloadJson, key, client);
      if (!event) {
        event = await eventRepository.findByTenantAndIdempotencyKey(tenantId, key, client);
      }
      resolvedEventId = event.id;
    } else {
      // Verify event exists and belongs to tenant
      const event = await eventRepository.findById(resolvedEventId);
      if (!event || event.tenantId !== tenantId) {
        const error = new Error('Event not found');
        error.statusCode = 404;
        throw error;
      }
    }

    // Allocate monotonic sequence number for endpoint
    const seq = await endpointRepository.allocate(endpointId, client);

    // Insert scheduled delivery with state 'SCHEDULED'
    const scheduledIso = scheduledDate.toISOString();
    const delivery = await deliveryRepository.insertScheduledDelivery(
      resolvedEventId,
      endpointId,
      seq,
      scheduledIso,
      client
    );

    logger.info('Delivery scheduled', {
      deliveryId: delivery.id,
      endpointId,
      eventId: resolvedEventId,
      tenantId,
      scheduledAt: scheduledIso,
    });

    return {
      ...delivery,
      endpointUrl: endpoint.url,
    };
  });
}

/**
 * List scheduled deliveries (tenant-scoped).
 *
 * @param {string} tenantId - Tenant UUID for access control
 * @param {Object} [filters={}] - Additional filter criteria
 * @param {Object} [pagination={}] - Pagination options
 * @returns {Promise<{ deliveries: Array, pagination: Object }>}
 */
export async function getScheduledDeliveries(tenantId, filters = {}, pagination = {}) {
  return await queryDeliveries(
    tenantId,
    { ...filters, state: deliveryState.SCHEDULED.toString() },
    pagination
  );
}

/**
 * Get a scheduled delivery by ID (tenant-scoped).
 *
 * @param {string} deliveryId - Delivery UUID
 * @param {string} tenantId - Tenant UUID for access control
 * @returns {Promise<Object|null>} Delivery object with attempts
 */
export async function getScheduledDeliveryById(deliveryId, tenantId) {
  return await getDeliveryById(deliveryId, tenantId);
}

/**
 * Cancel a scheduled delivery (tenant-scoped).
 * Only deliveries in SCHEDULED or PENDING state can be cancelled.
 *
 * @param {string} deliveryId - Delivery UUID
 * @param {string} tenantId - Tenant UUID for access control
 * @returns {Promise<Object>} Updated delivery
 */
export async function cancelScheduledDelivery(deliveryId, tenantId) {
  const delivery = await deliveryRepository.findByIdAndTenant(deliveryId, tenantId);
  if (!delivery) {
    const error = new Error('Delivery not found');
    error.statusCode = 404;
    throw error;
  }

  const currentState = delivery.state.toString();
  if (currentState !== 'SCHEDULED' && currentState !== 'PENDING') {
    throw new IllegalStateTransitionError(currentState, 'CANCELLED');
  }

  const cancelled = await deliveryRepository.cancelDelivery(deliveryId, tenantId);
  if (!cancelled) {
    const current = await deliveryRepository.findByIdAndTenant(deliveryId, tenantId);
    throw new IllegalStateTransitionError(current?.state?.toString() || currentState, 'CANCELLED');
  }

  logger.info('Delivery cancelled', {
    deliveryId,
    tenantId,
    endpointId: delivery.endpointId,
  });

  return cancelled;
}

/**
 * Bulk replay multiple failed (DEAD) deliveries.
 * Reuses the existing single-delivery replay implementation for each delivery.
 *
 * @param {Array<string>} deliveryIds - Array of delivery UUIDs
 * @param {string} tenantId - Tenant UUID for access control
 * @returns {Promise<Object>} Aggregated results with successful, ineligible, and rejected deliveries
 */
export async function bulkReplayDeliveries(deliveryIds, tenantId) {
  if (!Array.isArray(deliveryIds)) {
    const error = new Error('deliveryIds must be an array');
    error.statusCode = 400;
    throw error;
  }

  // Deduplicate delivery IDs to prevent duplicate execution in the same request
  const uniqueIds = [...new Set(deliveryIds.filter(Boolean))];

  const successful = [];
  const ineligible = [];
  const rejected = [];

  for (const deliveryId of uniqueIds) {
    try {
      const delivery = await deliveryRepository.findByIdAndTenant(deliveryId, tenantId);

      if (!delivery) {
        rejected.push({
          id: deliveryId,
          deliveryId,
          reason: 'Delivery not found or access denied',
        });
        continue;
      }

      const stateStr = delivery.state.toString();
      if (stateStr !== 'DEAD') {
        ineligible.push({
          id: deliveryId,
          deliveryId,
          state: stateStr,
          reason: `Delivery is in state ${stateStr}; only DEAD deliveries are eligible for replay`,
        });
        continue;
      }

      // Reuse single delivery replay implementation
      const replayed = await replayDelivery(deliveryId, tenantId);
      successful.push({
        id: replayed.id,
        deliveryId: replayed.id,
        eventId: replayed.eventId,
        endpointId: replayed.endpointId,
        endpointUrl: replayed.endpointUrl || delivery.endpointUrl || null,
        seq: replayed.seq,
        state: replayed.state.toString(),
        attemptCount: replayed.attemptCount,
        nextAttemptAt: replayed.nextAttemptAt,
      });
    } catch (err) {
      if (err instanceof IllegalStateTransitionError || err.name === 'IllegalStateTransitionError') {
        ineligible.push({
          id: deliveryId,
          deliveryId,
          reason: err.message,
        });
      } else if (err.statusCode === 404) {
        rejected.push({
          id: deliveryId,
          deliveryId,
          reason: 'Delivery not found or access denied',
        });
      } else {
        logger.error('Bulk replay single delivery error', {
          deliveryId,
          error: err.message,
        });
        rejected.push({
          id: deliveryId,
          deliveryId,
          reason: err.message,
        });
      }
    }
  }

  logger.info('Bulk replay completed', {
    tenantId,
    total: uniqueIds.length,
    successfulCount: successful.length,
    ineligibleCount: ineligible.length,
    rejectedCount: rejected.length,
  });

  return {
    total: uniqueIds.length,
    successful,
    replayed: successful,
    ineligible,
    rejected,
    summary: {
      total: uniqueIds.length,
      successfulCount: successful.length,
      replayedCount: successful.length,
      ineligibleCount: ineligible.length,
      rejectedCount: rejected.length,
    },
  };
}

export default {
  getDeliveriesByEvent,
  getDeliveriesByState,
  getAllDeliveries,
  getDeliveries,
  countDeliveries,
  queryDeliveries,
  getDeliveryById,
  getDeliveryAttempts,
  getDeliveryLogs,
  replayDelivery,
  scheduleDelivery,
  getScheduledDeliveries,
  getScheduledDeliveryById,
  cancelScheduledDelivery,
  bulkReplayDeliveries,
};
