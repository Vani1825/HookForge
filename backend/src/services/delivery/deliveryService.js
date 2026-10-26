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
 * @returns {Promise<Array>} Array of delivery objects
 */
export async function getDeliveriesByState(state, tenantId, limit = 100) {
  const deliveryStateEnum = deliveryState.fromString(state);
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

  return updated;
}

export default {
  getDeliveriesByEvent,
  getDeliveriesByState,
  replayDelivery,
};
