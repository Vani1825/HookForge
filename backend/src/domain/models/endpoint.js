/**
 * Endpoint domain model.
 * Immutable POJO representing an endpoint.
 */

import { v4 as uuidv4 } from 'uuid';
import { circuitState } from '../circuitState.js';

export function createEndpoint(data = {}) {
  const endpoint = {
    id: data.id || uuidv4(),
    tenantId: data.tenantId,
    url: data.url,
    secret: data.secret,
    active: data.active !== undefined ? data.active : true,
    rateLimitRps: data.rateLimitRps !== undefined ? data.rateLimitRps : 10,
    nextSeq: data.nextSeq !== undefined ? data.nextSeq : 1,
    circuitState: data.circuitState ? circuitState.fromString(data.circuitState) : circuitState.CLOSED,
    circuitUntil: data.circuitUntil || null,
    consecutiveFailures: data.consecutiveFailures !== undefined ? data.consecutiveFailures : 0,
    createdAt: data.createdAt || new Date().toISOString(),
  };

  return Object.freeze(endpoint);
}

/**
 * Convert endpoint to response DTO (excludes secret)
 */
export function toResponseDTO(endpoint) {
  const circuit = endpoint.circuitState.toString();
  return {
    id: endpoint.id,
    url: endpoint.url,
    active: endpoint.active,
    rateLimitRps: endpoint.rateLimitRps,
    rate_limit_rps: endpoint.rateLimitRps,
    circuitState: circuit,
    circuit_state: circuit,
    consecutiveFailures: endpoint.consecutiveFailures,
    consecutive_failures: endpoint.consecutiveFailures,
    nextSeq: endpoint.nextSeq,
    next_seq: endpoint.nextSeq,
    createdAt: endpoint.createdAt,
    created_at: endpoint.createdAt,
  };
}

export default { createEndpoint, toResponseDTO };
