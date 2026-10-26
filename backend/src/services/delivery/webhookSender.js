/**
 * WebhookSender port interface.
 * Sends HTTP requests to webhook endpoints.
 */

/**
 * Send a webhook delivery.
 * @param {string} url - Webhook URL
 * @param {string} body - Request body
 * @param {Object} headers - Request headers (including signature)
 * @param {number} timeoutMs - Request timeout in milliseconds
 * @returns {Promise<Object>} Send result with statusCode, latencyMs, error
 */
export async function send(url, body, headers, timeoutMs) {
  throw new Error('WebhookSender.send must be implemented');
}

export default {
  send,
};
