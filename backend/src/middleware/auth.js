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
  // Skip authentication for bypass paths
  // Exact match for /health
  if (BYPASS_PATHS.includes(req.path)) {
    return next();
  }

  // Prefix match for /actuator (allows /actuator/prometheus, /actuator/health, etc.)
  if (BYPASS_PREFIXES.some((prefix) => req.path.startsWith(prefix))) {
    return next();
  }

  const authHeader = req.headers.authorization;

  // Check for Authorization header
  if (!authHeader) {
    logger.warn('Missing Authorization header', {
      path: req.path,
      method: req.method,
    });
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing Authorization header',
    });
  }

  // Check for Bearer scheme and extract API key
  if (!authHeader.startsWith('Bearer ')) {
    logger.warn('Invalid Authorization scheme', {
      path: req.path,
      method: req.method,
    });
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authorization header must use Bearer scheme',
    });
  }

  // Extract API key (do not log the actual key)
  const apiKey = authHeader.substring(7); // Remove "Bearer " prefix

  if (!apiKey || apiKey.trim() === '') {
    logger.warn('Empty API key in Authorization header', {
      path: req.path,
      method: req.method,
    });
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Empty API key',
    });
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
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid API key',
      });
    }

    // Set tenant ID on request for downstream handlers
    req[TENANT_ID_ATTRIBUTE] = tenant.id;
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
