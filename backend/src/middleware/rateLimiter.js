/**
 * Inbound API Rate Limiting Middleware.
 * Provides IP-based pre-auth protection, per-tenant rate limiting, and health check rate limiting.
 */

import net from 'net';
import config from '../config/index.js';
import logger from '../utils/logger.js';
import { defaultRateLimitStore } from '../services/rateLimit/rateLimitStore.js';
import { TENANT_ID_ATTRIBUTE } from './auth.js';

/**
 * Safely extract client IP address from Express request.
 *
 * Security considerations:
 * - Express `req.ip` is used, which evaluates X-Forwarded-For according to the 'trust proxy' setting.
 * - When `trust proxy` is false (default), Express ignores X-Forwarded-For and reads from socket.remoteAddress.
 * - IPv4-mapped IPv6 addresses (::ffff:192.168.1.1) are normalized to standard IPv4.
 * - Validates IP address format using net.isIP().
 * - Returns 'unknown' if IP is missing, empty, or malformed, preventing crashes.
 *
 * @param {import('express').Request} req
 * @returns {string} Normalized client IP or 'unknown'
 */
export function getClientIp(req) {
  if (!req) return 'unknown';

  let rawIp = req.ip || req.socket?.remoteAddress;
  if (!rawIp || typeof rawIp !== 'string') {
    return 'unknown';
  }

  let ip = rawIp.trim();

  // Normalize IPv4-mapped IPv6 address (::ffff:x.x.x.x -> x.x.x.x)
  if (ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  }

  // Validate that it is a valid IPv4 or IPv6 address
  if (net.isIP(ip) === 0) {
    return 'unknown';
  }

  return ip;
}

/**
 * Record a failed authentication attempt for a given IP.
 *
 * @param {string} ip - Client IP
 * @param {import('../services/rateLimit/rateLimitStore.js').RateLimitStore} [store]
 */
export async function recordAuthFailure(ip, store = defaultRateLimitStore) {
  const { limit, windowMs } = config.rateLimit.authFail;
  return store.consume('auth_fail', ip, limit, windowMs);
}

/**
 * IP-based limiter applied before expensive API key hashing and PostgreSQL queries.
 * Throttles IPs that have accumulated too many failed authentication attempts.
 *
 * @param {Object} [options]
 * @param {import('../services/rateLimit/rateLimitStore.js').RateLimitStore} [options.store]
 */
export function authRateLimiter({ store = defaultRateLimitStore } = {}) {
  return async (req, res, next) => {
    const clientIp = getClientIp(req);
    const { limit, windowMs } = config.rateLimit.authFail;

    const status = await store.get('auth_fail', clientIp, limit, windowMs);
    if (!status.allowed) {
      logger.warn('Rate limit exceeded: too many failed authentication attempts', {
        ip: clientIp,
        path: req.path,
        method: req.method,
        retryAfter: status.retryAfterSeconds,
      });

      if (typeof res.setHeader === 'function') {
        res.setHeader('Retry-After', String(status.retryAfterSeconds));
      }

      return res.status(429).json({
        error: {
          type: 'rate_limit_exceeded',
          message: 'Too many failed authentication attempts. Please try again later.',
        },
      });
    }

    next();
  };
}

/**
 * Per-tenant rate limiter applied after successful authentication.
 * Uses the authenticated tenant ID attached to req by apiKeyAuth.
 * Never trusts client-supplied tenant IDs.
 *
 * @param {Object} [options]
 * @param {import('../services/rateLimit/rateLimitStore.js').RateLimitStore} [options.store]
 */
export function tenantRateLimiter({ store = defaultRateLimitStore } = {}) {
  return async (req, res, next) => {
    const tenantId = req.tenantId || req[TENANT_ID_ATTRIBUTE];
    if (!tenantId) {
      // If unauthenticated, let auth middleware handle 401
      return next();
    }

    const { limit, windowMs } = config.rateLimit.tenant;
    const result = await store.consume('tenant', tenantId, limit, windowMs);

    if (!result.allowed) {
      logger.warn('Rate limit exceeded for tenant', {
        tenantId,
        path: req.path,
        method: req.method,
        retryAfter: result.retryAfterSeconds,
      });

      if (typeof res.setHeader === 'function') {
        res.setHeader('Retry-After', String(result.retryAfterSeconds));
      }

      return res.status(429).json({
        error: {
          type: 'rate_limit_exceeded',
          message: 'Too many requests for tenant. Please try again later.',
        },
      });
    }

    next();
  };
}

/**
 * Health endpoint rate limiter.
 * Limits health-check requests per IP to protect the PostgreSQL connection pool.
 *
 * @param {Object} [options]
 * @param {import('../services/rateLimit/rateLimitStore.js').RateLimitStore} [options.store]
 */
export function healthRateLimiter({ store = defaultRateLimitStore } = {}) {
  return async (req, res, next) => {
    const clientIp = getClientIp(req);
    const { limit, windowMs } = config.rateLimit.health;
    const result = await store.consume('health', clientIp, limit, windowMs);

    if (!result.allowed) {
      logger.warn('Rate limit exceeded for health endpoint', {
        ip: clientIp,
        path: req.path,
        method: req.method,
        retryAfter: result.retryAfterSeconds,
      });

      if (typeof res.setHeader === 'function') {
        res.setHeader('Retry-After', String(result.retryAfterSeconds));
      }

      return res.status(429).json({
        error: {
          type: 'rate_limit_exceeded',
          message: 'Too many health check requests. Please try again later.',
        },
      });
    }

    next();
  };
}

export default {
  getClientIp,
  recordAuthFailure,
  authRateLimiter,
  tenantRateLimiter,
  healthRateLimiter,
};
