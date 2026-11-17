/**
 * LeaseReaper - Recovers expired IN_FLIGHT delivery leases.
 * Handles worker crashes by returning stuck deliveries to RETRYING or DEAD state.
 * Performs set-based batch recovery using FOR UPDATE SKIP LOCKED.
 */

import deliveryRepository from '../../repositories/jdbc/deliveryRepository.js';
import config from '../../config/index.js';
import clock from '../../utils/clock.js';
import logger from '../../utils/logger.js';

/**
 * Recover expired IN_FLIGHT deliveries in bounded batches.
 * @param {Object} timeSource - Clock instance (defaults to system)
 * @param {Object} [options={}] - Batch recovery options (batchSize, maxAttempts)
 * @returns {Promise<number>} Number of deliveries recovered
 */
export async function recoverExpiredLeases(timeSource = clock.system, options = {}) {
  const now = timeSource.now();
  const maxAttempts = options.maxAttempts ?? config?.retry?.maxAttempts ?? 8;
  const batchSize = options.batchSize ?? config?.dispatcher?.batchSize ?? 100;

  try {
    const recovered = await deliveryRepository.recoverExpiredLeasesBatch(
      now,
      batchSize,
      maxAttempts
    );

    if (recovered.length > 0) {
      for (const item of recovered) {
        logger.info('Recovered expired lease', {
          deliveryId: item.id,
          endpointId: item.endpointId,
          seq: item.seq,
          state: item.state,
          attemptCount: item.attemptCount,
        });
      }
    }

    return recovered.length;
  } catch (error) {
    logger.error('Failed to recover expired leases', { error: error.message });
    throw error;
  }
}

export default {
  recoverExpiredLeases,
};
