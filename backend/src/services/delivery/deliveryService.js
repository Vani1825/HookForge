/**
 * DeliveryService - Service layer for delivery status and replay operations.
 * Handles tenant-scoped queries and replay state transitions.
 */

import deliveryRepository from '../../repositories/jdbc/deliveryRepository.js';
import { deliveryState } from '../../domain/deliveryState.js';
import { IllegalStateTransitionError } from '../../domain/errors/illegalStateTransitionError.js';
import logger from '../../utils/logger.js';

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
 * Get delivery by ID with attempts (tenant-scoped).
 * @param {string} deliveryId - Delivery UUID
 * @param {string} tenantId - Tenant UUID for access control
 * @returns {Promise<Object|null>} Delivery object with attempts
 */
export async function getDeliveryById(deliveryId, tenantId) {
  const delivery = await deliveryRepository.findByIdAndTenant(deliveryId, tenantId);
  if (!delivery) return null;

  const attempts = await deliveryRepository.findAttemptsByDeliveryId(deliveryId);
  return {
    ...delivery,
    attempts,
  };
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

export default {
  getDeliveriesByEvent,
  getDeliveriesByState,
  getAllDeliveries,
  getDeliveries,
  countDeliveries,
  queryDeliveries,
  getDeliveryById,
  replayDelivery,
};
