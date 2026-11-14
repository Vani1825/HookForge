/**
 * ApiKeyAuthFilter - API key authentication middleware.
 * Validates Bearer token and sets tenant ID on request.
 *
 * Based on reference's ApiKeyAuthFilter:
 * - Extracts Authorization: Bearer <api-key> header
 * - Computes SHA-256 hash of API key
 * - Queries tenant repository by hash
 * - Sets req.tenantId attribute
 * - Returns 401 if invalid or missing
 * - Skips /health and /actuator paths
 */

import crypto from 'crypto';
import tenantRepository from '../repositories/jdbc/tenantRepository.js';
import logger from '../utils/logger.js';
import config from '../config/index.js';
import { getClientIp, recordAuthFailure } from './rateLimiter.js';
import { defaultRateLimitStore } from '../services/rateLimit/rateLimitStore.js';

/**
 * Request attribute key for tenant ID (matches reference's TenantAttributes.TENANT_ID)
 */
export const TENANT_ID_ATTRIBUTE = 'tenantId';

/**
 * Paths that bypass authentication
 * /health is exact match only
 * /actuator and its subpaths are allowed (for metrics/health endpoints)
 * NOTE: Any route starting with /actuator will bypass auth (documented limitation)
 */
const BYPASS_PATHS = ['/health'];
const BYPASS_PREFIXES = ['/actuator'];

/**
 * Compute SHA-256 hash of API key (hex string)
 * @param {string} apiKey - The raw API key
 * @returns {string} Hex-encoded SHA-256 hash
 */
function hashApiKey(apiKey) {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

/**
 * Express middleware for API key authentication
 */
export async function apiKeyAuth(req, res, next) {
  // If already authenticated by parent middleware, proceed
  if (req[TENANT_ID_ATTRIBUTE] || req.tenantId) {
    return next();
  }

  // Skip authentication for bypass paths
  const currentPath = req.path || '';
  const originalPath = req.originalUrl || '';

  // Exact match for /health
  if (
    BYPASS_PATHS.includes(currentPath) ||
    BYPASS_PATHS.some((p) => originalPath === p || originalPath.startsWith(`${p}?`))
  ) {
    return next();
  }

  // Prefix match for /actuator (allows /actuator/prometheus, /actuator/health, etc.)
  if (
    BYPASS_PREFIXES.some((prefix) => currentPath.startsWith(prefix) || originalPath.startsWith(prefix))
  ) {
    return next();
  }

  const clientIp = getClientIp(req);

  // Pre-auth IP rate limiter: protect against brute-force and DB connection exhaustion
  const authLimitStatus = await defaultRateLimitStore.get(
    'auth_fail',
    clientIp,
    config.rateLimit.authFail.limit,
    config.rateLimit.authFail.windowMs
  );
  if (!authLimitStatus.allowed) {
    logger.warn('Rate limit exceeded: too many failed authentication attempts', {
      ip: clientIp,
      path: req.path,
    });
    if (typeof res.setHeader === 'function') {
      res.setHeader('Retry-After', String(authLimitStatus.retryAfterSeconds));
    }
    return res.status(429).json({
      error: {
        type: 'rate_limit_exceeded',
        message: 'Too many failed authentication attempts. Please try again later.',
      },
    });
  }

  const rawAuthHeader = Array.isArray(req.headers.authorization)
    ? req.headers.authorization[0]
    : req.headers.authorization;
  const rawXApiKey = Array.isArray(req.headers['x-api-key'])
    ? req.headers['x-api-key'][0]
    : req.headers['x-api-key'];

  let apiKey = null;

  const setAuthHeaderAndRespond401 = async (message) => {
    await recordAuthFailure(clientIp);
    if (typeof res.setHeader === 'function') {
      res.setHeader('WWW-Authenticate', 'Bearer realm="HookForge"');
    }
    return res.status(401).json({
      error: 'Unauthorized',
      message,
    });
  };

  if (rawAuthHeader) {
    const trimmedHeader = rawAuthHeader.trim();
    if (trimmedHeader.toLowerCase() === 'bearer') {
      logger.warn('Empty API key in Authorization header', {
        path: req.path,
        method: req.method,
      });
      return await setAuthHeaderAndRespond401('Empty API key');
    }

    // Check for Bearer scheme (case-insensitive) and extract API key
    if (!rawAuthHeader.toLowerCase().startsWith('bearer ')) {
      logger.warn('Invalid Authorization scheme', {
        path: req.path,
        method: req.method,
      });
      return await setAuthHeaderAndRespond401('Authorization header must use Bearer scheme');
    }

    apiKey = rawAuthHeader.substring(7).trim(); // Remove "Bearer " prefix and trim

    if (!apiKey) {
      logger.warn('Empty API key in Authorization header', {
        path: req.path,
        method: req.method,
      });
      return await setAuthHeaderAndRespond401('Empty API key');
    }
  } else if (rawXApiKey) {
    apiKey = String(rawXApiKey).trim();
    if (!apiKey) {
      logger.warn('Empty API key in X-Api-Key header', {
        path: req.path,
        method: req.method,
      });
      return await setAuthHeaderAndRespond401('Empty API key');
    }
  } else {
    logger.warn('Missing Authorization header', {
      path: req.path,
      method: req.method,
    });
    return await setAuthHeaderAndRespond401('Missing Authorization header');
  }

  // Compute hash and look up tenant
  const apiKeyHash = hashApiKey(apiKey);

  try {
    const tenant = await tenantRepository.findByApiKeyHash(apiKeyHash);

    if (!tenant) {
      logger.warn('Invalid API key - tenant not found', {
        path: req.path,
        method: req.method,
      });
      return await setAuthHeaderAndRespond401('Invalid API key');
    }

    // Set tenant ID on request for downstream handlers
    req[TENANT_ID_ATTRIBUTE] = tenant.id;
    req.tenantId = tenant.id;
    logger.debug('Authentication successful', {
      tenantId: tenant.id,
      path: req.path,
    });
    next();
  } catch (error) {
    logger.error('Authentication error', {
      error: error.message,
      path: req.path,
    });
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Authentication failed',
    });
  }
}

export default {
  apiKeyAuth,
  TENANT_ID_ATTRIBUTE,
};
