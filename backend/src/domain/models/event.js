/**
 * Event domain model.
 * Immutable POJO representing an event.
 */

import { v4 as uuidv4 } from 'uuid';

export function createEvent(data = {}) {
  return Object.freeze({
    id: data.id || uuidv4(),
    tenantId: data.tenantId,
    payloadJson: data.payloadJson,
    idempotencyKey: data.idempotencyKey,
    createdAt: data.createdAt || new Date().toISOString(),
  });
}

export default { createEvent };
