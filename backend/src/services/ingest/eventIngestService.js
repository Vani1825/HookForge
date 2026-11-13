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
    // 1. Initial check for existing idempotency key
    const existing = await eventRepository.findByTenantAndIdempotencyKey(
      tenantId,
      idempotencyKey,
      client
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

    // 2. Atomic insert with ON CONFLICT DO NOTHING (handles concurrent duplicate race conditions)
    const event = await eventRepository.insert(tenantId, payloadJson, idempotencyKey, client);

    // If event is null, another concurrent request committed an event with the same idempotency key
    if (!event) {
      const concurrentExisting = await eventRepository.findByTenantAndIdempotencyKey(
        tenantId,
        idempotencyKey,
        client
      );
      logger.info('Concurrent duplicate idempotency key resolved', {
        eventId: concurrentExisting?.id,
        tenantId,
        idempotencyKey,
      });
      return {
        duplicate: true,
        event: concurrentExisting,
        deliveriesEnqueued: 0,
      };
    }

    // 3. Find all active endpoints for tenant (ORDER BY id for stable lock order) within the transaction
    const activeEndpoints = await endpointRepository.findActiveByTenant(tenantId, client);

    // 4. For each endpoint (stable order), allocate sequence and enqueue delivery using transaction client
    let deliveriesEnqueued = 0;
    for (const endpoint of activeEndpoints) {
      const seq = await endpointRepository.allocate(endpoint.id, client);
      await deliveryEnqueuer.enqueue(event.id, endpoint.id, seq, client);
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
