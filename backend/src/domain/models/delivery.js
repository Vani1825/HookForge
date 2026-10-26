/**
 * Delivery domain model.
 * Immutable POJO representing a delivery.
 */

import { v4 as uuidv4 } from 'uuid';
import { deliveryState } from '../deliveryState.js';

export function createDelivery(data = {}) {
  return Object.freeze({
    id: data.id || uuidv4(),
    eventId: data.eventId,
    endpointId: data.endpointId,
    seq: data.seq,
    state: data.state ? deliveryState.fromString(data.state) : deliveryState.PENDING,
    attemptCount: data.attemptCount !== undefined ? data.attemptCount : 0,
    nextAttemptAt: data.nextAttemptAt || new Date().toISOString(),
    leaseUntil: data.leaseUntil || null,
    lastError: data.lastError || null,
    createdAt: data.createdAt || new Date().toISOString(),
    updatedAt: data.updatedAt || new Date().toISOString(),
  });
}

export default { createDelivery };
