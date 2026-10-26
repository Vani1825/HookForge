/**
 * ThresholdCircuitBreaker - Circuit breaker with failure threshold and timeout.
 * States: CLOSED (normal), OPEN (blocked), HALF_OPEN (probing).
 */

import { circuitState } from '../../domain/circuitState.js';
import { deliveryOutcome } from '../../domain/deliveryOutcome.js';

const FAILURE_THRESHOLD = 5;
const OPEN_DURATION_MS = 60000; // 1 minute

/**
 * Should attempt delivery based on circuit state.
 * @param {string} endpointId - Endpoint UUID
 * @param {Object} endpoint - Endpoint object with circuit state
 * @param {number} now - Current timestamp in milliseconds
 * @returns {Promise<boolean>} True if delivery should be attempted
 */
export async function shouldAttempt(endpointId, endpoint, now) {
  const currentCircuitState = endpoint.circuitState?.toString() || endpoint.circuitState;
  const circuitUntil = endpoint.circuitUntil;

  if (currentCircuitState === 'CLOSED') {
    return true;
  }

  if (currentCircuitState === 'OPEN') {
    // Check if circuit should transition to HALF_OPEN
    if (circuitUntil && now >= new Date(circuitUntil).getTime()) {
      return true; // Probe
    }
    return false; // Still open
  }

  if (currentCircuitState === 'HALF_OPEN') {
    return true; // Allow probe
  }

  return false;
}

/**
 * Record delivery result and update circuit state.
 * @param {string} endpointId - Endpoint UUID
 * @param {Object} outcome - Delivery outcome
 * @param {Object} endpoint - Current endpoint state
 * @param {number} now - Current timestamp in milliseconds
 * @returns {Promise<Object|null>} Circuit state update or null if no change
 */
export async function recordResult(endpointId, outcome, endpoint, now) {
  const currentFailures = endpoint.consecutiveFailures || 0;
  const currentCircuitState = endpoint.circuitState?.toString() || endpoint.circuitState;
  const outcomeStr = outcome?.toString() || outcome;
  const isFailure = outcome && typeof outcome.countsAsEndpointFailure === 'function'
    ? outcome.countsAsEndpointFailure()
    : outcomeStr === 'RETRY';

  if (outcome === deliveryOutcome.SUCCESS || outcomeStr === 'SUCCESS') {
    // Success: reset to CLOSED, failures = 0
    return {
      circuitState: circuitState.CLOSED,
      circuitUntil: null,
      consecutiveFailures: 0,
    };
  }

  if (isFailure) {
    // Failure: increment failures
    const newFailures = currentFailures + 1;
    // If HALF_OPEN or failures >= threshold -> OPEN
    if (currentCircuitState === 'HALF_OPEN' || newFailures >= FAILURE_THRESHOLD) {
      return {
        circuitState: circuitState.OPEN,
        circuitUntil: new Date(now + OPEN_DURATION_MS).toISOString(),
        consecutiveFailures: newFailures,
      };
    }
    // Increment failures but stay in CLOSED
    return {
      circuitState: circuitState.CLOSED,
      circuitUntil: null,
      consecutiveFailures: newFailures,
    };
  }

  // Non-failure outcome (RATE_LIMITED, RETRY_LIMITED): no circuit change
  return null;
}

export default {
  shouldAttempt,
  recordResult,
};
