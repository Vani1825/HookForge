/**
 * HttpWebhookSender - HTTP implementation of WebhookSender port.
 * Uses Node.js native http/https with connection pinning to prevent
 * DNS rebinding, TOCTOU vulnerabilities, and SSRF attacks.
 */

import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import logger from '../../utils/logger.js';
import {
  validateAndResolveUrl,
  sanitizeUrlForLogging,
  isSameOrigin,
} from '../../utils/ssrf.js';

const DEFAULT_TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 3;

/**
 * Origin-bound sensitive headers that must NEVER be forwarded cross-origin on redirect.
 * Specifically includes X-Webhook-Signature because the HMAC signature is cryptographically
 * tied to the original webhook request/target and must not leak.
 */
const CROSS_ORIGIN_STRIPPED_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'x-webhook-signature',
  'x-api-key',
  'api-key',
  'x-auth-token',
]);

/**
 * Execute a single HTTP/HTTPS request hop with connection pinning.
 *
 * @param {Object} resolution - Output from validateAndResolveUrl
 * @param {string} method - HTTP method (POST, GET, etc.)
 * @param {string|Buffer|Object|null} body - Request body
 * @param {Object} headers - Request headers
 * @param {number} timeoutMs - Timeout in milliseconds for this hop
 * @returns {Promise<{ statusCode: number|null, headers: Object|null, error: string|null }>}
 */
function executeHop(resolution, method, body, headers, timeoutMs) {
  return new Promise((resolve) => {
    const isHttps = resolution.protocol === 'https:';
    const client = isHttps ? https : http;

    const isGetOrHead = method === 'GET' || method === 'HEAD';
    let bodyBuffer = Buffer.alloc(0);

    if (!isGetOrHead && body !== null && body !== undefined) {
      if (Buffer.isBuffer(body)) {
        bodyBuffer = body;
      } else if (typeof body === 'string') {
        bodyBuffer = Buffer.from(body, 'utf8');
      } else {
        bodyBuffer = Buffer.from(JSON.stringify(body), 'utf8');
      }
    }

    const reqHeaders = {
      'Host': resolution.url.host,
      ...headers,
    };

    if (!isGetOrHead && bodyBuffer.length > 0) {
      if (!reqHeaders['Content-Type'] && !reqHeaders['content-type']) {
        reqHeaders['Content-Type'] = 'application/json';
      }
      reqHeaders['Content-Length'] = bodyBuffer.length;
    } else if (isGetOrHead) {
      delete reqHeaders['Content-Length'];
      delete reqHeaders['content-length'];
      delete reqHeaders['Content-Type'];
      delete reqHeaders['content-type'];
    }

    const reqOptions = {
      protocol: resolution.protocol,
      hostname: resolution.hostname,
      port: resolution.port,
      path: resolution.path,
      method,
      headers: reqHeaders,
      agent: false, // Ensure fresh socket without connection pool reuse
      // RFC 6066: Do not send SNI for IP literals
      servername: resolution.isIpLiteral ? undefined : resolution.hostname,
    };

    // Connection pinning: guarantee the socket connects to the pre-validated IP address
    if (resolution.pinnedAddress) {
      reqOptions.lookup = (_host, opts, cb) => {
        if (opts && opts.all) {
          cb(null, [{ address: resolution.pinnedAddress, family: resolution.pinnedFamily }]);
        } else {
          cb(null, resolution.pinnedAddress, resolution.pinnedFamily);
        }
      };
    }

    let isDone = false;
    let timer = null;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const req = client.request(reqOptions, (res) => {
      // Drain response stream to release socket
      res.resume();
      res.on('end', () => {
        if (isDone) return;
        isDone = true;
        cleanup();
        resolve({
          statusCode: res.statusCode ?? null,
          headers: res.headers,
          error: null,
        });
      });
    });

    req.on('error', (err) => {
      if (isDone) return;
      isDone = true;
      cleanup();
      const isTimeout =
        err.name === 'TimeoutError' ||
        err.message === 'Timeout' ||
        err.code === 'ETIMEDOUT' ||
        err.code === 'ESOCKETTIMEDOUT';
      resolve({
        statusCode: null,
        headers: null,
        error: isTimeout ? 'Timeout' : err.message,
      });
    });

    // Enforce request timeout
    timer = setTimeout(() => {
      if (isDone) return;
      const timeoutErr = new Error('Timeout');
      timeoutErr.name = 'TimeoutError';
      req.destroy(timeoutErr);
    }, timeoutMs);

    if (!isGetOrHead && bodyBuffer.length > 0) {
      req.write(bodyBuffer);
    }
    req.end();
  });
}

/**
 * Send a webhook delivery with SSRF validation, connection pinning, and safe redirect validation.
 *
 * @param {string} url - Destination webhook URL
 * @param {string} body - Payload body string
 * @param {Object} [headers] - Optional headers map
 * @param {number} [timeoutMs] - Request timeout in milliseconds (defaults to 15000)
 * @param {Object} [options] - Optional overrides (e.g. dnsLookup, allowLocal, followRedirects, maxRedirects)
 * @returns {Promise<{ statusCode: number|null, latencyMs: number, error: string|null }>}
 */
export async function send(url, body, headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS, options = {}) {
  const startTime = Date.now();
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  let currentUrl = url;
  let currentMethod = 'POST';
  let currentBody = body;
  let currentHeaders = { ...headers };
  let redirectCount = 0;

  while (true) {
    const elapsedMs = Date.now() - startTime;
    if (elapsedMs >= timeoutMs) {
      logger.error('Webhook delivery timed out before dispatch', {
        url: sanitizeUrlForLogging(currentUrl),
        latencyMs: elapsedMs,
      });
      return {
        statusCode: null,
        latencyMs: elapsedMs,
        error: 'Timeout',
      };
    }
    const remainingTimeout = timeoutMs - elapsedMs;

    // 1. SSRF validation & connection IP resolution
    let resolution;
    try {
      resolution = await validateAndResolveUrl(currentUrl, {
        ...options,
        dnsTimeoutMs: options.dnsTimeoutMs ?? remainingTimeout,
      });
    } catch (ssrfErr) {
      const latencyMs = Date.now() - startTime;
      const isTimeout =
        ssrfErr.name === 'TimeoutError' ||
        ssrfErr.message === 'Timeout' ||
        ssrfErr.code === 'ETIMEDOUT';

      if (isTimeout) {
        logger.error('Webhook dispatch timed out during DNS resolution', {
          url: sanitizeUrlForLogging(currentUrl),
          latencyMs,
        });
        return {
          statusCode: null,
          latencyMs,
          error: 'Timeout',
        };
      }

      logger.error('Webhook dispatch blocked by SSRF protection', {
        url: sanitizeUrlForLogging(currentUrl),
        error: ssrfErr.message,
      });
      return {
        statusCode: null,
        latencyMs,
        error: `Blocked by SSRF protection: ${ssrfErr.message}`,
      };
    }

    // Fail closed if pinned IP is unavailable
    if (!resolution.pinnedAddress) {
      const latencyMs = Date.now() - startTime;
      logger.error('Webhook dispatch blocked: no pinned IP address', {
        url: sanitizeUrlForLogging(currentUrl),
      });
      return {
        statusCode: null,
        latencyMs,
        error: 'Blocked by SSRF protection: No pinned IP address available for destination',
      };
    }

    // Ensure expired requests cannot proceed to an outbound connection after DNS resolution completes
    const postDnsElapsedMs = Date.now() - startTime;
    if (postDnsElapsedMs >= timeoutMs) {
      logger.error('Webhook delivery timed out after DNS resolution', {
        url: sanitizeUrlForLogging(currentUrl),
        latencyMs: postDnsElapsedMs,
      });
      return {
        statusCode: null,
        latencyMs: postDnsElapsedMs,
        error: 'Timeout',
      };
    }
    const hopRemainingTimeout = timeoutMs - postDnsElapsedMs;

    // 2. Execute single hop with pinned IP
    const hopResult = await executeHop(
      resolution,
      currentMethod,
      currentBody,
      currentHeaders,
      hopRemainingTimeout
    );

    // 3. Handle Hop Failure
    if (hopResult.error) {
      const latencyMs = Date.now() - startTime;
      logger.error('Webhook delivery failed', {
        url: sanitizeUrlForLogging(currentUrl),
        error: hopResult.error,
        latencyMs,
      });
      return {
        statusCode: null,
        latencyMs,
        error: hopResult.error,
      };
    }

    // 4. Handle Redirects (301, 302, 303, 307, 308)
    const isRedirectStatus =
      hopResult.statusCode >= 300 &&
      hopResult.statusCode < 400 &&
      hopResult.statusCode !== 304;

    if (isRedirectStatus && options.followRedirects !== false) {
      if (redirectCount >= maxRedirects) {
        const latencyMs = Date.now() - startTime;
        logger.error('Webhook delivery failed: too many redirects', {
          url: sanitizeUrlForLogging(currentUrl),
          redirectCount,
        });
        return {
          statusCode: hopResult.statusCode,
          latencyMs,
          error: 'Too many redirects',
        };
      }

      const rawLocation = hopResult.headers.location;
      if (typeof rawLocation !== 'string' || !rawLocation.trim()) {
        const latencyMs = Date.now() - startTime;
        logger.warn('Webhook redirect rejected: empty Location header', {
          from: sanitizeUrlForLogging(currentUrl),
        });
        return {
          statusCode: null,
          latencyMs,
          error: 'Invalid redirect Location header',
        };
      }

      let nextUrl;
      try {
        nextUrl = new URL(rawLocation.trim(), currentUrl).toString();
      } catch {
        const latencyMs = Date.now() - startTime;
        logger.warn('Webhook redirect rejected: invalid Location header', {
          from: sanitizeUrlForLogging(currentUrl),
        });
        return {
          statusCode: null,
          latencyMs,
          error: 'Invalid redirect Location header',
        };
      }

      // Check scheme of nextUrl: must be http: or https:
      let nextParsed;
      try {
        nextParsed = new URL(nextUrl);
        if (nextParsed.protocol !== 'http:' && nextParsed.protocol !== 'https:') {
          const latencyMs = Date.now() - startTime;
          logger.warn('Webhook redirect rejected: disallowed protocol', {
            from: sanitizeUrlForLogging(currentUrl),
          });
          return {
            statusCode: null,
            latencyMs,
            error: `Blocked by SSRF protection: Disallowed redirect URL scheme '${nextParsed.protocol}'`,
          };
        }
      } catch {
        const latencyMs = Date.now() - startTime;
        return {
          statusCode: null,
          latencyMs,
          error: 'Invalid redirect Location header',
        };
      }

      // Reject HTTPS -> HTTP downgrade to prevent plaintext transmission of webhook payloads
      if (resolution.protocol === 'https:' && nextParsed.protocol === 'http:') {
        const latencyMs = Date.now() - startTime;
        logger.warn('Webhook redirect rejected: insecure HTTPS to HTTP downgrade', {
          from: sanitizeUrlForLogging(currentUrl),
        });
        return {
          statusCode: null,
          latencyMs,
          error: 'Blocked by SSRF protection: Insecure redirect downgrade from HTTPS to HTTP is disallowed',
        };
      }

      logger.debug('Following webhook redirect', {
        from: sanitizeUrlForLogging(currentUrl),
        to: sanitizeUrlForLogging(nextUrl),
        statusCode: hopResult.statusCode,
      });

      // Handle Cross-Origin Header Security:
      // Strip sensitive origin-bound credentials and HMAC signatures on cross-origin redirects
      const sameOrigin = isSameOrigin(currentUrl, nextUrl);
      if (!sameOrigin) {
        const safeHeaders = {};
        for (const [key, val] of Object.entries(currentHeaders)) {
          if (!CROSS_ORIGIN_STRIPPED_HEADERS.has(key.toLowerCase())) {
            safeHeaders[key] = val;
          }
        }
        currentHeaders = safeHeaders;
      }

      // Handle Redirect Method & Body Semantics:
      // 301, 302, 303: Rewrite method to GET and discard body
      // 307, 308: Preserve original method (POST) and body
      if (
        hopResult.statusCode === 301 ||
        hopResult.statusCode === 302 ||
        hopResult.statusCode === 303
      ) {
        currentMethod = 'GET';
        currentBody = null;
        const cleanHeaders = {};
        for (const [k, v] of Object.entries(currentHeaders)) {
          const lk = k.toLowerCase();
          if (lk !== 'content-type' && lk !== 'content-length' && lk !== 'x-webhook-signature') {
            cleanHeaders[k] = v;
          }
        }
        currentHeaders = cleanHeaders;
      } else if (hopResult.statusCode === 307 || hopResult.statusCode === 308) {
        currentMethod = 'POST';
        currentBody = body; // Preserved
      }

      currentUrl = nextUrl;
      redirectCount++;
      continue;
    }

    // 5. Normal final response
    const latencyMs = Date.now() - startTime;
    logger.debug('Webhook sent', {
      url: sanitizeUrlForLogging(currentUrl),
      statusCode: hopResult.statusCode,
      latencyMs,
    });

    return {
      statusCode: hopResult.statusCode,
      latencyMs,
      error: null,
    };
  }
}

export default {
  send,
};
