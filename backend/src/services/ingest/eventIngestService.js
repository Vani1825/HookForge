/**
 * EventIngestService - Business logic for event ingestion.
 * Handles idempotent event creation and delivery fan-out to active endpoints.
 */

import eventRepository from '../../repositories/jdbc/eventRepository.js';
import { transaction } from '../../config/database.js';
import config from '../../config/index.js';
import { PayloadTooLargeError } from '../../middleware/errorHandler.js';
import logger from '../../utils/logger.js';

/**
 * Ingest an event with idempotency.
 * Single transaction: either event and all deliveries exist, or nothing does.
 *
 * @param {string} tenantId - Tenant UUID
 * @param {string} idempotencyKey - Idempotency key
 * @param {string} payloadJson - JSON payload as string
 * @returns {Promise<Object>} Ingest result with event and delivery count
 */
export async function ingest(tenantId, idempotencyKey, payloadJson) {
  // Configurable size cap (defaults to config.ingest.maxPayloadBytes) - reject before DB
  const maxPayloadBytes = config?.ingest?.maxPayloadBytes ?? 262144;
  const payloadBytes = Buffer.byteLength(payloadJson, 'utf8');
  if (payloadBytes > maxPayloadBytes) {
    throw new PayloadTooLargeError(
      `Payload too large (${payloadBytes} bytes, maximum allowed is ${maxPayloadBytes} bytes)`
    );
  }

  // Single transaction for event + deliveries
  return await transaction(async (client) => {
    // 1. Attempt direct insert with ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
    const event = await eventRepository.insert(tenantId, payloadJson, idempotencyKey, client);

    // If event is null, conflict occurred (duplicate idempotency key)
    if (!event) {
      const existing = await eventRepository.findByTenantAndIdempotencyKey(
        tenantId,
        idempotencyKey,
        client
      );
      logger.info('Duplicate idempotency key', {
        eventId: existing?.id,
        tenantId,
        idempotencyKey,
      });
      return {
        duplicate: true,
        event: existing,
        deliveriesEnqueued: 0,
      };
    }

    // 2. Batch fan-out: allocate sequences and enqueue deliveries in a single set-based SQL operation
    const deliveries = await eventRepository.enqueueBatch(tenantId, event.id, client);
    const deliveriesEnqueued = deliveries.length;

    logger.info('Event ingested', {
      eventId: event.id,
      tenantId,
      deliveriesEnqueued,
    });

    return {
      duplicate: false,
      event,
      deliveriesEnqueued,
    };
  });
}

export default {
  ingest,
};
