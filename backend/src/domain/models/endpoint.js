/**
 * Endpoint domain model.
 * Immutable POJO representing an endpoint.
 */

import { v4 as uuidv4 } from 'uuid';
import { circuitState } from '../circuitState.js';

export const RETRY_STRATEGY = Object.freeze({
  EXPONENTIAL: 'EXPONENTIAL',
  FIXED: 'FIXED',
});

export function createEndpoint(data = {}) {
  const rawStrategy = data.retryStrategy ?? data.retry_strategy ?? 'EXPONENTIAL';
  const retryStrategy = String(rawStrategy).toUpperCase();

  const retryMaxAttempts =
    data.retryMaxAttempts !== undefined
      ? Number(data.retryMaxAttempts)
      : (data.retry_max_attempts !== undefined ? Number(data.retry_max_attempts) : 8);

  const retryBaseDelayMs =
    data.retryBaseDelayMs !== undefined
      ? Number(data.retryBaseDelayMs)
      : (data.retry_base_delay_ms !== undefined
          ? Number(data.retry_base_delay_ms)
          : (data.retryDelayMs !== undefined
              ? Number(data.retryDelayMs)
              : (data.retry_delay_ms !== undefined ? Number(data.retry_delay_ms) : 5000)));

  const retryMaxDelayMs =
    data.retryMaxDelayMs !== undefined
      ? Number(data.retryMaxDelayMs)
      : (data.retry_max_delay_ms !== undefined ? Number(data.retry_max_delay_ms) : 3600000);

  const retryBackoffMultiplier =
    data.retryBackoffMultiplier !== undefined
      ? Number(data.retryBackoffMultiplier)
      : (data.retry_backoff_multiplier !== undefined ? Number(data.retry_backoff_multiplier) : 2.0);

  const endpoint = {
    id: data.id || uuidv4(),
    tenantId: data.tenantId,
    url: data.url,
    secret: data.secret,
    secretCiphertext: data.secretCiphertext ?? data.secret_ciphertext ?? null,
    secretIv: data.secretIv ?? data.secret_iv ?? null,
    secretTag: data.secretTag ?? data.secret_tag ?? null,
    secretVersion:
      data.secretVersion !== undefined
        ? data.secretVersion
        : (data.secret_version !== undefined ? data.secret_version : null),
    active: data.active !== undefined ? data.active : true,
    rateLimitRps: data.rateLimitRps !== undefined ? data.rateLimitRps : 10,
    nextSeq: data.nextSeq !== undefined ? data.nextSeq : 1,
    circuitState: data.circuitState ? circuitState.fromString(data.circuitState) : circuitState.CLOSED,
    circuitUntil: data.circuitUntil || null,
    consecutiveFailures: data.consecutiveFailures !== undefined ? data.consecutiveFailures : 0,
    retryStrategy,
    retryMaxAttempts,
    retryBaseDelayMs,
    retryMaxDelayMs,
    retryBackoffMultiplier,
    createdAt: data.createdAt || new Date().toISOString(),
  };

  return Object.freeze(endpoint);
}

/**
 * Convert endpoint to response DTO (excludes secret)
 */
export function toResponseDTO(endpoint) {
  const circuit = endpoint.circuitState ? endpoint.circuitState.toString() : 'CLOSED';
  const retryStrategy = endpoint.retryStrategy || 'EXPONENTIAL';
  const retryMaxAttempts = endpoint.retryMaxAttempts !== undefined ? endpoint.retryMaxAttempts : 8;
  const retryBaseDelayMs = endpoint.retryBaseDelayMs !== undefined ? endpoint.retryBaseDelayMs : 5000;
  const retryMaxDelayMs = endpoint.retryMaxDelayMs !== undefined ? endpoint.retryMaxDelayMs : 3600000;
  const retryBackoffMultiplier =
    endpoint.retryBackoffMultiplier !== undefined ? endpoint.retryBackoffMultiplier : 2.0;

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
    retryStrategy,
    retry_strategy: retryStrategy,
    retryMaxAttempts,
    retry_max_attempts: retryMaxAttempts,
    retryBaseDelayMs,
    retry_base_delay_ms: retryBaseDelayMs,
    retryMaxDelayMs,
    retry_max_delay_ms: retryMaxDelayMs,
    retryBackoffMultiplier,
    retry_backoff_multiplier: retryBackoffMultiplier,
    retryPolicy: {
      strategy: retryStrategy,
      maxAttempts: retryMaxAttempts,
      baseDelayMs: retryBaseDelayMs,
      maxDelayMs: retryMaxDelayMs,
      backoffMultiplier: retryBackoffMultiplier,
    },
    createdAt: endpoint.createdAt,
    created_at: endpoint.createdAt,
  };
}

export default { createEndpoint, toResponseDTO, RETRY_STRATEGY };
