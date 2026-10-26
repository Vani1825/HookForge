/**
 * Dispatcher - Worker loop for processing webhook deliveries.
 * Polls for due deliveries, checks resilience guards, executes webhooks, and handles outcomes.
 */

import deliveryRepository from '../../repositories/jdbc/deliveryRepository.js';
import { findActiveByTenant } from '../../repositories/jdbc/endpointRepository.js';
import { findAll } from '../../repositories/jdbc/tenantRepository.js';
import attemptExecutor from './attemptExecutor.js';
import { handleOutcome } from './outcomeHandler.js';
import { shouldAttempt } from '../resilience/thresholdCircuitBreaker.js';
import { tryAcquire } from '../resilience/tokenBucketRateLimiter.js';
import { recoverExpiredLeases } from '../resilience/leaseReaper.js';
import { deliveryState } from '../../domain/deliveryState.js';
import clock from '../../utils/clock.js';
import logger from '../../utils/logger.js';

const LEASE_DURATION_MS = 30000; // 30 seconds
const POLL_INTERVAL_MS = 1000; // 1 second
const LEASE_REAPER_INTERVAL_MS = 60000; // 1 minute

let isRunning = false;
let pollTimer = null;
let reaperTimer = null;

/**
 * Process a single delivery.
 * @param {Object} delivery - Delivery to process
 * @param {Object} endpoint - Endpoint for the delivery
 * @returns {Promise<void>}
 */
async function processDelivery(delivery, endpoint) {
  const now = clock.system.now();

  try {
    // Check circuit breaker
    const canAttempt = await shouldAttempt(endpoint.id, endpoint, now);
    if (!canAttempt) {
      logger.debug('Circuit breaker blocked delivery', {
        deliveryId: delivery.id,
        endpointId: endpoint.id,
        circuitState: endpoint.circuitState.toString(),
      });
      // Release lease for later retry
      await deliveryRepository.releaseLease(
        delivery.id,
        deliveryState.RETRYING,
        new Date(now + 60000).toISOString(),
        'Circuit breaker open'
      );
      return;
    }

    // Check rate limiter
    const rateLimitAllowed = await tryAcquire(endpoint.id, endpoint.rateLimitRps);
    if (!rateLimitAllowed) {
      logger.debug('Rate limiter blocked delivery', {
        deliveryId: delivery.id,
        endpointId: endpoint.id,
        rateLimitRps: endpoint.rateLimitRps,
      });
      // Release lease for later retry
      await deliveryRepository.releaseLease(
        delivery.id,
        deliveryState.RETRYING,
        new Date(now + 1000).toISOString(),
        'Rate limited'
      );
      return;
    }

    // Execute webhook delivery
    const attempt = await attemptExecutor.execute(delivery, endpoint);

    // Handle outcome
    await handleOutcome(delivery, attempt.outcome, attempt, endpoint);
  } catch (error) {
    logger.error('Error processing delivery', {
      deliveryId: delivery.id,
      endpointId: endpoint.id,
      error: error.message,
      stack: error.stack,
    });

    // Release lease on error
    await deliveryRepository.releaseLease(
      delivery.id,
      deliveryState.RETRYING,
      new Date(now + 5000).toISOString(),
      error.message
    );
  }
}

/**
 * Poll for and process due deliveries.
 */
export async function poll() {
  const promises = [];
  try {
    // Get all tenants
    const tenants = await findAll();
    
    // For each tenant, get active endpoints
    for (const tenant of tenants) {
      const endpoints = await findActiveByTenant(tenant.id);
      
      // For each endpoint, try to claim a delivery
      for (const endpoint of endpoints) {
        const delivery = await deliveryRepository.claim(endpoint.id, LEASE_DURATION_MS);
        
        if (delivery) {
          // Process delivery
          promises.push(
            processDelivery(delivery, endpoint).catch((error) => {
              logger.error('Delivery processing error', {
                deliveryId: delivery.id,
                error: error.message,
              });
            })
          );
        }
      }
    }
    await Promise.all(promises);
  } catch (error) {
    logger.error('Error in poll loop', { error: error.message });
  }
}

/**
 * Start the dispatcher.
 */
export function start() {
  if (isRunning) {
    logger.warn('Dispatcher already running');
    return;
  }

  isRunning = true;
  logger.info('Starting dispatcher');

  // Start poll loop
  pollTimer = setInterval(poll, POLL_INTERVAL_MS);

  // Start lease reaper loop
  reaperTimer = setInterval(async () => {
    try {
      const recovered = await recoverExpiredLeases();
      if (recovered > 0) {
        logger.info('Lease reaper recovered deliveries', { count: recovered });
      }
    } catch (error) {
      logger.error('Lease reaper error', { error: error.message });
    }
  }, LEASE_REAPER_INTERVAL_MS);

  // Initial poll
  poll();
}

/**
 * Stop the dispatcher.
 */
export function stop() {
  if (!isRunning) {
    logger.warn('Dispatcher not running');
    return;
  }

  isRunning = false;
  logger.info('Stopping dispatcher');

  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  if (reaperTimer) {
    clearInterval(reaperTimer);
    reaperTimer = null;
  }
}

export default {
  start,
  stop,
  poll,
  processDelivery,
};
