/**
 * OutcomeHandler - Handles delivery outcomes and state transitions.
 * Coordinates retry policy, circuit breaker updates, and persistence.
 */

import { deliveryState } from '../../domain/deliveryState.js';
import { deliveryOutcome } from '../../domain/deliveryOutcome.js';
import deliveryRepository from '../../repositories/jdbc/deliveryRepository.js';
import { saveCircuit } from '../../repositories/jdbc/endpointRepository.js';
import exponentialJitterRetryPolicy from '../resilience/exponentialJitterRetryPolicy.js';
import thresholdCircuitBreaker from '../resilience/thresholdCircuitBreaker.js';
import clock from '../../utils/clock.js';
import logger from '../../utils/logger.js';

/**
 * Handle delivery outcome and update state.
 * @param {Object} delivery - Delivery object
 * @param {Object} outcome - Delivery outcome
 * @param {Object} attempt - Delivery attempt details
 * @param {Object} endpoint - Endpoint object (for circuit breaker)
 * @param {Object} retryPolicy - Retry policy instance (optional)
 * @param {Object} timeSource - Clock instance (optional)
 * @returns {Promise<Object>} Updated delivery
 */
export async function handleOutcome(
  delivery,
  outcome,
  attempt,
  endpoint,
  retryPolicy = exponentialJitterRetryPolicy,
  timeSource = clock.system
) {
  const now = timeSource.now();
  const attemptCount = delivery.attemptCount + 1;

  // Record the attempt
  await deliveryRepository.recordAttempt({
    deliveryId: delivery.id,
    attemptNo: attemptCount,
    startedAt: attempt.startedAt,
    statusCode: attempt.statusCode,
    latencyMs: attempt.latencyMs,
    error: attempt.error,
  });

  // Increment attempt count
  await deliveryRepository.incrementAttemptCount(delivery.id);

  const outcomeStr = outcome?.toString() || outcome;

  // Handle based on outcome
  if (outcome === deliveryOutcome.SUCCESS || outcomeStr === 'SUCCESS') {
    // Mark as SUCCEEDED
    const updated = await deliveryRepository.markTerminal(delivery.id, deliveryState.SUCCEEDED);
    
    // Update circuit breaker on success
    const circuitUpdate = await thresholdCircuitBreaker.recordResult(
      endpoint.id,
      outcome,
      endpoint,
      now
    );
    if (circuitUpdate) {
      await saveCircuit(endpoint.id, circuitUpdate);
    }

    logger.info('Delivery succeeded', {
      deliveryId: delivery.id,
      endpointId: endpoint.id,
      attemptCount,
    });

    return updated;
  }

  if (outcome === deliveryOutcome.ENDPOINT_GONE || outcomeStr === 'ENDPOINT_GONE') {
    // Mark as DEAD (permanent failure)
    const updated = await deliveryRepository.markTerminal(delivery.id, deliveryState.DEAD);
    
    // Update circuit breaker
    const circuitUpdate = await thresholdCircuitBreaker.recordResult(
      endpoint.id,
      outcome,
      endpoint,
      now
    );
    if (circuitUpdate) {
      await saveCircuit(endpoint.id, circuitUpdate);
    }

    logger.warn('Delivery marked DEAD (endpoint gone)', {
      deliveryId: delivery.id,
      endpointId: endpoint.id,
      attemptCount,
    });

    return updated;
  }

  // Retryable outcomes: RETRY, RATE_LIMITED, RETRY_LIMITED
  const delay = await retryPolicy.nextDelay(attemptCount, outcome);

  if (delay === null) {
    // No more retries - mark as DEAD
    const updated = await deliveryRepository.markTerminal(delivery.id, deliveryState.DEAD);
    
    // Update circuit breaker
    const circuitUpdate = await thresholdCircuitBreaker.recordResult(
      endpoint.id,
      outcome,
      endpoint,
      now
    );
    if (circuitUpdate) {
      await saveCircuit(endpoint.id, circuitUpdate);
    }

    logger.warn('Delivery marked DEAD (retry limit exceeded)', {
      deliveryId: delivery.id,
      endpointId: endpoint.id,
      attemptCount,
      outcome: outcome.toString(),
    });

    return updated;
  }

  // Schedule retry
  const nextAttemptAt = new Date(now + delay).toISOString();
  const updated = await deliveryRepository.releaseLease(
    delivery.id,
    deliveryState.RETRYING,
    nextAttemptAt,
    attempt.error || 'Retryable failure'
  );

  // Update circuit breaker
  const circuitUpdate = await thresholdCircuitBreaker.recordResult(
    endpoint.id,
    outcome,
    endpoint,
    now
  );
  if (circuitUpdate) {
    await saveCircuit(endpoint.id, circuitUpdate);
  }

  logger.info('Delivery scheduled for retry', {
    deliveryId: delivery.id,
    endpointId: endpoint.id,
    attemptCount,
    outcome: outcome.toString(),
    delay,
    nextAttemptAt,
  });

  return updated;
}

export default {
  handleOutcome,
};
