/**
 * ResponseClassifier port interface.
 * Classifies HTTP responses into delivery outcomes.
 */

/**
 * Classify HTTP response into delivery outcome.
 * @param {number} statusCode - HTTP status code
 * @returns {Object} Delivery outcome (SUCCESS, RETRY, RATE_LIMITED, RETRY_LIMITED, ENDPOINT_GONE)
 */
export function classify(statusCode) {
  throw new Error('ResponseClassifier.classify must be implemented');
}

export default {
  classify,
};
