/**
 * HmacSha256Signer - HMAC-SHA256 webhook signature implementation.
 * Generates X-Webhook-Signature header.
 *
 * Format: t=<unix>,v1=hex(HMAC_SHA256(secret, "<t>.<body>"))
 */

import crypto from 'crypto';

/**
 * Sign a webhook payload.
 * @param {string} secret - HMAC signing secret
 * @param {string} body - Raw payload body
 * @param {number} timestamp - Unix timestamp in seconds
 * @returns {string} Signature header value
 */
export function sign(secret, body, timestamp) {
  const signedPayload = `${timestamp}.${body}`;
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(signedPayload);
  const signature = hmac.digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

export default {
  sign,
};
