/**
 * EventIngestService - Business logic for event ingestion.
 * Handles idempotent event creation and delivery fan-out to active endpoints.
 */

import eventRepository from '../../repositories/jdbc/eventRepository.js';
import deliveryEnqueuer from '../../repositories/jdbc/eventRepository.js';
import endpointRepository from '../../repositories/jdbc/endpointRepository.js';
import { transaction } from '../../config/database.js';
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
  // Size cap (256KB) - reject before DB
  const sizeLimit = 256 * 1024; // 256KB
  if (Buffer.byteLength(payloadJson, 'utf8') > sizeLimit) {
    throw new Error('Payload too large (max 256KB)');
  }

  // Single transaction for event + deliveries
  return await transaction(async (client) => {
    // Try insert event with ON CONFLICT behavior handled by checking first
    const existing = await eventRepository.findByTenantAndIdempotencyKey(
      tenantId,
      idempotencyKey
    );

    if (existing) {
      logger.info('Duplicate idempotency key', {
        eventId: existing.id,
        tenantId,
        idempotencyKey,
      });
      return {
        duplicate: true,
        event: existing,
        deliveriesEnqueued: 0,
      };
    }

    // Insert new event
    const event = await eventRepository.insert(tenantId, payloadJson, idempotencyKey);

    // Find all active endpoints for tenant (ORDER BY id for stable lock order)
    const activeEndpoints = await endpointRepository.findActiveByTenant(tenantId);

    // For each endpoint (stable order), allocate sequence and enqueue delivery
    let deliveriesEnqueued = 0;
    for (const endpoint of activeEndpoints) {
      const seq = await endpointRepository.allocate(endpoint.id);
      await deliveryEnqueuer.enqueue(event.id, endpoint.id, seq);
      deliveriesEnqueued++;
    }

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
