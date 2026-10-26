/**
 * HttpWebhookSender - HTTP implementation of WebhookSender port.
 * Uses fetch API to send webhook deliveries.
 */

import logger from '../../utils/logger.js';

/**
 * Send a webhook delivery.
 */
export async function send(url, body, headers, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const startTime = Date.now();

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const latencyMs = Date.now() - startTime;
    const statusCode = response.status;

    logger.debug('Webhook sent', { url, statusCode, latencyMs });

    return {
      statusCode,
      latencyMs,
      error: null,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    const latencyMs = Date.now() - startTime;

    logger.error('Webhook delivery failed', {
      url,
      error: error.message,
      latencyMs,
    });

    return {
      statusCode: null,
      latencyMs,
      error: error.name === 'AbortError' ? 'Timeout' : error.message,
    };
  }
}

export default {
  send,
};
