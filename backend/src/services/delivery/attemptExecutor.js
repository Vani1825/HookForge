/**
 * AttemptExecutor - Executes a single delivery attempt.
 * Signs the payload, sends the webhook, and classifies the outcome.
 */

import { sign } from './hmacSha256Signer.js';
import httpWebhookSender from './httpWebhookSender.js';
import { classify } from './defaultResponseClassifier.js';
import { createDeliveryAttempt } from '../../domain/models/deliveryAttempt.js';
import { deliveryOutcome } from '../../domain/deliveryOutcome.js';
import { findById } from '../../repositories/jdbc/eventRepository.js';
import { sanitizeHeaders, sanitizeResponseBody } from '../../utils/redaction.js';
import config from '../../config/index.js';
import logger from '../../utils/logger.js';

const RESPONSE_CAPTURE_LIMIT_BYTES = 65536;

/**
 * Execute a single delivery attempt.
 * @param {Object} delivery - Delivery object
 * @param {Object} endpoint - Endpoint object with url and secret
 * @returns {Promise<Object>} Delivery attempt with outcome
 */
export async function execute(delivery, endpoint) {
  const startedAt = new Date().toISOString();
  const timestamp = Math.floor(Date.now() / 1000); // Unix timestamp in seconds
  let safeRequestHeaders = null;

  try {
    // Get event payload
    const event = await findById(delivery.eventId);
    if (!event) {
      throw new Error(`Event not found: ${delivery.eventId}`);
    }

    const payloadJson = typeof event.payloadJson === 'string'
      ? event.payloadJson
      : JSON.stringify(event.payloadJson);

    // Generate signature
    const signature = sign(endpoint.secret, payloadJson, timestamp);

    // Configurable timeouts and response limits
    const connectTimeoutMs = config?.http?.connectTimeoutMs ?? 3000;
    const readTimeoutMs = config?.http?.readTimeoutMs ?? 10000;
    const maxResponseBytes = config?.http?.maxResponseBytes ?? 1048576;
    const timeoutMs = connectTimeoutMs + readTimeoutMs;

    const requestHeaders = {
      'Content-Type': 'application/json',
      'X-Webhook-Id': delivery.id,
      'X-Webhook-Signature': signature,
      'X-Webhook-Timestamp': timestamp.toString(),
    };

    // Safe request headers for logging & persistence (never persist signature plaintext)
    safeRequestHeaders = sanitizeHeaders(requestHeaders);

    // Send webhook with configured timeouts, response limits, and bounded response capture
    const result = await httpWebhookSender.send(
      endpoint.url,
      payloadJson,
      requestHeaders,
      timeoutMs,
      {
        connectTimeoutMs,
        readTimeoutMs,
        maxResponseBytes,
        captureResponse: true,
        captureResponseBody: true,
        maxCaptureBytes: RESPONSE_CAPTURE_LIMIT_BYTES,
      }
    );

    // Classify outcome
    const outcome = classify(result.statusCode);

    const safeResponseHeaders = result.headers ? sanitizeHeaders(result.headers) : null;
    const safeResponseBody = result.body ? sanitizeResponseBody(result.body, RESPONSE_CAPTURE_LIMIT_BYTES) : null;

    logger.info('Delivery attempt completed', {
      deliveryId: delivery.id,
      attemptNo: delivery.attemptCount + 1,
      statusCode: result.statusCode,
      outcome: outcome.toString(),
      latencyMs: result.latencyMs,
    });

    return createDeliveryAttempt({
      deliveryId: delivery.id,
      attemptNo: delivery.attemptCount + 1,
      startedAt,
      statusCode: result.statusCode,
      latencyMs: result.latencyMs,
      error: result.error,
      outcome,
      responseBody: safeResponseBody,
      responseHeaders: safeResponseHeaders,
      requestHeaders: safeRequestHeaders,
    });
  } catch (error) {
    logger.error('Delivery attempt failed', {
      deliveryId: delivery.id,
      error: error.message,
    });

    // Return failure attempt
    return createDeliveryAttempt({
      deliveryId: delivery.id,
      attemptNo: delivery.attemptCount + 1,
      startedAt,
      statusCode: null,
      latencyMs: 0,
      error: error.message,
      outcome: deliveryOutcome.RETRY,
      responseBody: null,
      responseHeaders: null,
      requestHeaders: safeRequestHeaders || {
        'Content-Type': 'application/json',
        'X-Webhook-Id': delivery.id,
        'X-Webhook-Timestamp': timestamp.toString(),
        'X-Webhook-Signature': '[REDACTED]',
      },
    });
  }
}

export default {
  execute,
};
