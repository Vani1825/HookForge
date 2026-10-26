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
import logger from '../../utils/logger.js';

const CONNECT_TIMEOUT_MS = 5000;
const READ_TIMEOUT_MS = 10000;

/**
 * Execute a single delivery attempt.
 * @param {Object} delivery - Delivery object
 * @param {Object} endpoint - Endpoint object with url and secret
 * @returns {Promise<Object>} Delivery attempt with outcome
 */
export async function execute(delivery, endpoint) {
  const startedAt = new Date().toISOString();
  const timestamp = Math.floor(Date.now() / 1000); // Unix timestamp in seconds

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

    // Send webhook
    const timeoutMs = CONNECT_TIMEOUT_MS + READ_TIMEOUT_MS;
    const result = await httpWebhookSender.send(
      endpoint.url,
      payloadJson,
      {
        'X-Webhook-Id': delivery.id,
        'X-Webhook-Signature': signature,
        'X-Webhook-Timestamp': timestamp.toString(),
      },
      timeoutMs
    );

    // Classify outcome
    const outcome = classify(result.statusCode);

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
    });
  }
}

export default {
  execute,
};
