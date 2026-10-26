/**
 * EndpointHealthStore port interface.
 * Persists circuit breaker state for endpoints.
 * Used by the circuit breaker to track endpoint health.
 */

/**
 * Save circuit breaker state update.
 * @param {string} endpointId - Endpoint UUID
 * @param {Object} update - Circuit state update (circuitState, circuitUntil, consecutiveFailures)
 * @returns {Promise<void>}
 */
export async function saveCircuit(endpointId, update) {
  throw new Error('EndpointHealthStore.saveCircuit must be implemented');
}

/**
 * Deactivate an endpoint (set active = false).
 * Used when endpoint is permanently gone (410 Gone).
 * @param {string} endpointId - Endpoint UUID
 * @returns {Promise<void>}
 */
export async function deactivate(endpointId) {
  throw new Error('EndpointHealthStore.deactivate must be implemented');
}

export default {
  saveCircuit,
  deactivate,
};
