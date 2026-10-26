/**
 * SequenceAllocator port interface.
 * Atomically allocates the next sequence number for an endpoint.
 * Used during event ingestion to ensure per-endpoint ordering.
 */

/**
 * Allocate the next sequence number for an endpoint.
 * Atomically increments endpoints.next_seq and returns the value BEFORE increment.
 * Must run inside a transaction (rollback rolls back the sequence).
 *
 * @param {string} endpointId - Endpoint UUID
 * @returns {Promise<number>} The allocated sequence number
 */
export async function allocate(endpointId) {
  throw new Error('SequenceAllocator.allocate must be implemented');
}

export default {
  allocate,
};
