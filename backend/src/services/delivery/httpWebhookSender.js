/**
 * HttpWebhookSender - HTTP implementation of WebhookSender port.
 * Uses Node.js native http/https with connection pinning to prevent
 * DNS rebinding, TOCTOU vulnerabilities, and SSRF attacks.
 */

import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import config from '../../config/index.js';
import logger from '../../utils/logger.js';
import {
  validateAndResolveUrl,
  sanitizeUrlForLogging,
  isSameOrigin,
} from '../../utils/ssrf.js';

const DEFAULT_CONNECT_TIMEOUT_MS = config?.http?.connectTimeoutMs ?? 3000;
const DEFAULT_READ_TIMEOUT_MS = config?.http?.readTimeoutMs ?? 10000;
const DEFAULT_MAX_RESPONSE_BYTES = config?.http?.maxResponseBytes ?? 1048576; // 1 MB
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
function executeHop(resolution, method, body, headers, hopTimeoutMs, hopOptions = {}) {
  return new Promise((resolve) => {
    const isHttps = resolution.protocol === 'https:';
    const client = isHttps ? https : http;

    const connectTimeoutMs =
      hopOptions.connectTimeoutMs ??
      config?.http?.connectTimeoutMs ??
      DEFAULT_CONNECT_TIMEOUT_MS;
    const readTimeoutMs =
      hopOptions.readTimeoutMs ??
      config?.http?.readTimeoutMs ??
      DEFAULT_READ_TIMEOUT_MS;
    const maxResponseBytes =
      hopOptions.maxResponseBytes ??
      config?.http?.maxResponseBytes ??
      DEFAULT_MAX_RESPONSE_BYTES;

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
    let connectTimer = null;
    let readTimer = null;
    let overallTimer = null;
    let socketRef = null;

    const cleanup = () => {
      if (connectTimer) {
        clearTimeout(connectTimer);
        connectTimer = null;
      }
      if (readTimer) {
        clearTimeout(readTimer);
        readTimer = null;
      }
      if (overallTimer) {
        clearTimeout(overallTimer);
        overallTimer = null;
      }
    };

    const hopStartTime = Date.now();

    // 1. Overall hop timer ensuring the hop never exceeds the remaining deadline
    overallTimer = setTimeout(() => {
      if (isDone) return;
      isDone = true;
      cleanup();
      const timeoutErr = new Error('Timeout');
      timeoutErr.name = 'TimeoutError';
      timeoutErr.code = 'ETIMEDOUT';
      req.destroy(timeoutErr);
      if (socketRef && !socketRef.destroyed) socketRef.destroy();
      resolve({
        statusCode: null,
        headers: null,
        error: 'Timeout',
      });
    }, hopTimeoutMs);

    // 2. Connection phase timer: covers establishing TCP connection (+ TLS handshake)
    const effectiveConnectTimeout = Math.min(connectTimeoutMs, hopTimeoutMs);
    connectTimer = setTimeout(() => {
      if (isDone) return;
      isDone = true;
      cleanup();
      const timeoutErr = new Error('ConnectTimeout');
      timeoutErr.name = 'TimeoutError';
      timeoutErr.code = 'ETIMEDOUT';
      req.destroy(timeoutErr);
      if (socketRef && !socketRef.destroyed) socketRef.destroy();
      resolve({
        statusCode: null,
        headers: null,
        error: 'Timeout',
      });
    }, effectiveConnectTimeout);

    function onConnected() {
      // Clear connect timer as soon as connection is established
      if (connectTimer) {
        clearTimeout(connectTimer);
        connectTimer = null;
      }
      startReadTimeout();
    }

    function startReadTimeout() {
      if (isDone || readTimer) return;
      const elapsed = Date.now() - hopStartTime;
      const remainingHop = Math.max(1, hopTimeoutMs - elapsed);
      const effectiveReadTimeout = Math.min(readTimeoutMs, remainingHop);

      readTimer = setTimeout(() => {
        if (isDone) return;
        isDone = true;
        cleanup();
        const timeoutErr = new Error('ReadTimeout');
        timeoutErr.name = 'TimeoutError';
        timeoutErr.code = 'ETIMEDOUT';
        req.destroy(timeoutErr);
        if (socketRef && !socketRef.destroyed) socketRef.destroy();
        resolve({
          statusCode: null,
          headers: null,
          error: 'Timeout',
        });
      }, effectiveReadTimeout);
    }

    const req = client.request(reqOptions, (res) => {
      onConnected();

      // Check Content-Length header immediately
      const rawContentLength = res.headers['content-length'];
      if (rawContentLength !== undefined && rawContentLength !== null && rawContentLength !== '') {
        const contentLength = parseInt(rawContentLength, 10);
        if (Number.isInteger(contentLength) && contentLength > maxResponseBytes) {
          if (isDone) return;
          isDone = true;
          cleanup();
          const sizeErr = new Error(
            `Response size exceeded maximum allowed limit of ${maxResponseBytes} bytes`
          );
          sizeErr.name = 'ResponseTooLargeError';
          const activeSocket = res.socket || socketRef;
          res.destroy();
          req.destroy(sizeErr);
          if (activeSocket && !activeSocket.destroyed) activeSocket.destroy();
          return resolve({
            statusCode: null,
            headers: null,
            error: `Response size exceeded maximum allowed limit of ${maxResponseBytes} bytes`,
          });
        }
      }

      // Incrementally count streamed response bytes
      let receivedBytes = 0;

      res.on('data', (chunk) => {
        receivedBytes += chunk.length;
        if (receivedBytes > maxResponseBytes) {
          if (isDone) return;
          isDone = true;
          cleanup();
          const sizeErr = new Error(
            `Response size exceeded maximum allowed limit of ${maxResponseBytes} bytes`
          );
          sizeErr.name = 'ResponseTooLargeError';
          const activeSocket = res.socket || socketRef;
          res.destroy();
          req.destroy(sizeErr);
          if (activeSocket && !activeSocket.destroyed) activeSocket.destroy();
          resolve({
            statusCode: null,
            headers: null,
            error: `Response size exceeded maximum allowed limit of ${maxResponseBytes} bytes`,
          });
        }
      });

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

      res.on('error', (err) => {
        if (isDone) return;
        isDone = true;
        cleanup();
        if (socketRef && !socketRef.destroyed) socketRef.destroy();
        resolve({
          statusCode: null,
          headers: null,
          error: err.message,
        });
      });
    });

    req.on('socket', (socket) => {
      socketRef = socket;
      if (socket.connecting) {
        const connectEvent = isHttps ? 'secureConnect' : 'connect';
        socket.once(connectEvent, onConnected);
      } else {
        onConnected();
      }
    });

    req.on('error', (err) => {
      if (isDone) return;
      isDone = true;
      cleanup();
      if (socketRef && !socketRef.destroyed) socketRef.destroy();
      const isTimeout =
        err.name === 'TimeoutError' ||
        err.message === 'Timeout' ||
        err.message === 'ConnectTimeout' ||
        err.message === 'ReadTimeout' ||
        err.code === 'ETIMEDOUT' ||
        err.code === 'ESOCKETTIMEDOUT';
      const isTooLarge =
        err.name === 'ResponseTooLargeError' ||
        err.message?.includes('Response size exceeded');

      let errorMsg = err.message;
      if (isTimeout) {
        errorMsg = 'Timeout';
      } else if (isTooLarge) {
        errorMsg = err.message;
      }

      resolve({
        statusCode: null,
        headers: null,
        error: errorMsg,
      });
    });

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
 * @param {number} [timeoutMs] - Request timeout in milliseconds (defaults to connectTimeout + readTimeout)
 * @param {Object} [options] - Optional overrides (e.g. dnsLookup, allowLocal, followRedirects, maxRedirects, connectTimeoutMs, readTimeoutMs, maxResponseBytes)
 * @returns {Promise<{ statusCode: number|null, latencyMs: number, error: string|null }>}
 */
export async function send(url, body, headers = {}, timeoutMs, options = {}) {
  const startTime = Date.now();
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  const connectTimeoutMs =
    options.connectTimeoutMs ??
    config?.http?.connectTimeoutMs ??
    DEFAULT_CONNECT_TIMEOUT_MS;
  const readTimeoutMs =
    options.readTimeoutMs ??
    config?.http?.readTimeoutMs ??
    DEFAULT_READ_TIMEOUT_MS;
  const maxResponseBytes =
    options.maxResponseBytes ??
    config?.http?.maxResponseBytes ??
    DEFAULT_MAX_RESPONSE_BYTES;
  const effectiveTimeoutMs =
    timeoutMs ?? (connectTimeoutMs + readTimeoutMs);
  let currentUrl = url;
  let currentMethod = 'POST';
  let currentBody = body;
  let currentHeaders = { ...headers };
  let redirectCount = 0;

  while (true) {
    const elapsedMs = Date.now() - startTime;
    if (elapsedMs >= effectiveTimeoutMs) {
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
    const remainingTimeout = effectiveTimeoutMs - elapsedMs;

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
    if (postDnsElapsedMs >= effectiveTimeoutMs) {
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
    const hopRemainingTimeout = effectiveTimeoutMs - postDnsElapsedMs;

    // 2. Execute single hop with pinned IP
    const hopResult = await executeHop(
      resolution,
      currentMethod,
      currentBody,
      currentHeaders,
      hopRemainingTimeout,
      {
        ...options,
        connectTimeoutMs,
        readTimeoutMs,
        maxResponseBytes,
      }
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
