/**
 * CORS Middleware for HookForge.
 * 
 * Supports:
 * - Dynamic origin verification with localhost support in development
 * - Strict origin whitelisting in production (unrestricted '*' is forbidden)
 * - OPTIONS preflight handling with 204 No Content
 * - Secure credential support (Access-Control-Allow-Credentials: true)
 * - Comprehensive method & header exposure
 */

import config from '../config/index.js';

export const ALLOWED_METHODS = 'GET, POST, PATCH, PUT, DELETE, OPTIONS';
export const ALLOWED_HEADERS = 'Content-Type, Authorization, Idempotency-Key, X-Api-Key, Accept';
export const MAX_AGE_SECONDS = '86400';

/**
 * Determine whether a given request origin is permitted.
 * @param {string} origin - Incoming Origin header value
 * @param {boolean} isProduction - True if running in production mode
 * @param {string[]} allowedOrigins - Configured allowed origins array
 * @returns {boolean} True if origin is permitted
 */
export function isOriginAllowed(
  origin,
  isProduction = config.nodeEnv === 'production',
  allowedOrigins = config.cors.allowedOrigins
) {
  if (!origin || origin === '*') return false;

  // In production: must match an explicitly configured origin (wildcard '*' is strictly forbidden)
  if (isProduction) {
    return allowedOrigins.filter((o) => o !== '*').includes(origin);
  }

  // In non-production (development, test):
  if (allowedOrigins.includes('*')) {
    return true;
  }
  if (allowedOrigins.includes(origin)) {
    return true;
  }

  // In development, also automatically permit localhost and 127.0.0.1 on any port
  try {
    const url = new URL(origin);
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

/**
 * Express middleware for CORS handling
 */
export function corsMiddleware(req, res, next) {
  const origin = req.headers.origin;
  const isProduction = config.nodeEnv === 'production';

  res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
  res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
  res.setHeader('Access-Control-Max-Age', MAX_AGE_SECONDS);

  if (origin) {
    const allowed = isOriginAllowed(origin, isProduction, config.cors.allowedOrigins);

    if (allowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    } else {
      // Origin is not allowed
      if (req.method === 'OPTIONS') {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'CORS origin not allowed',
        });
      }
      // For actual non-OPTIONS requests from unauthorized origins,
      // omit Access-Control-Allow-Origin so the browser will block access.
    }
  } else if (!isProduction && config.cors.allowedOrigins.includes('*')) {
    // Non-production fallback for requests without an Origin header
    res.setHeader('Access-Control-Allow-Origin', '*');
  }

  // Preflight requests return 204 No Content
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  next();
}

export default corsMiddleware;
