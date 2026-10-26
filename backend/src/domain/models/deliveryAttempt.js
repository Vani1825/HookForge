/**
 * DeliveryAttempt domain model.
 * Immutable POJO representing a delivery attempt audit record.
 */

export function createDeliveryAttempt(data = {}) {
  return Object.freeze({
    deliveryId: data.deliveryId,
    attemptNo: data.attemptNo,
    startedAt: data.startedAt || new Date().toISOString(),
    statusCode: data.statusCode || null,
    latencyMs: data.latencyMs || 0,
    error: data.error || null,
    outcome: data.outcome || null,
  });
}

export default { createDeliveryAttempt };
