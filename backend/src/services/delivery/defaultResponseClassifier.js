/**
 * DefaultResponseClassifier - HTTP response classification.
 * Classifies HTTP responses into delivery outcomes per reference.
 */

import { deliveryOutcome } from '../../domain/deliveryOutcome.js';

/**
 * Classify HTTP response into delivery outcome.
 *
 * SUCCESS: 2xx → mark SUCCEEDED
 * RETRY: 5xx, timeout, connection error → retry with backoff, counts toward circuit breaker
 * RATE_LIMITED: 429 → retry, honor Retry-After header
 * RETRY_LIMITED: Other 4xx, 3xx → limited retries (3 attempts max)
 * ENDPOINT_GONE: 410 Gone → deactivate endpoint, mark DEAD
 */
export function classify(statusCode) {
  if (statusCode === null) {
    // Connection error or timeout
    return deliveryOutcome.RETRY;
  }

  if (statusCode >= 200 && statusCode < 300) {
    return deliveryOutcome.SUCCESS;
  }

  if (statusCode === 410) {
    return deliveryOutcome.ENDPOINT_GONE;
  }

  if (statusCode === 429) {
    return deliveryOutcome.RATE_LIMITED;
  }

  if (statusCode >= 500) {
    return deliveryOutcome.RETRY;
  }

  // Other 4xx and 3xx
  return deliveryOutcome.RETRY_LIMITED;
}

export default {
  classify,
};
