/**
 * DeliveryAttempt domain model.
 * Immutable POJO representing a delivery attempt audit record.
 */

export function createDeliveryAttempt(data = {}) {
  return Object.freeze({
    id: data.id || null,
    deliveryId: data.deliveryId,
    attemptNo: data.attemptNo,
    startedAt: data.startedAt || new Date().toISOString(),
    statusCode: data.statusCode !== undefined ? data.statusCode : null,
    latencyMs: data.latencyMs || 0,
    error: data.error || null,
    outcome: data.outcome || null,
    responseBody: data.responseBody ?? data.response_body ?? null,
    responseHeaders: data.responseHeaders ?? data.response_headers ?? null,
    requestHeaders: data.requestHeaders ?? data.request_headers ?? null,
  });
}

export default { createDeliveryAttempt };
