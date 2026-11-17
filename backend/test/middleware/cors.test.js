/**
 * Unit tests for CORS middleware.
 * Verifies allowed origins, methods, headers, OPTIONS preflight,
 * credentials, and production restrictions (no unrestricted origins).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  corsMiddleware,
  isOriginAllowed,
  ALLOWED_METHODS,
  ALLOWED_HEADERS,
  MAX_AGE_SECONDS,
} from '../../src/middleware/cors.js';
import config from '../../src/config/index.js';

describe('CORS Middleware', () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      method: 'GET',
      headers: {},
      path: '/endpoints',
    };
    res = {
      headers: {},
      setHeader: vi.fn((key, val) => {
        res.headers[key.toLowerCase()] = val;
      }),
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      end: vi.fn(),
    };
    next = vi.fn();
  });

  describe('Headers and Methods', () => {
    it('should set standard CORS methods and headers', () => {
      corsMiddleware(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Methods', ALLOWED_METHODS);
      expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Headers', ALLOWED_HEADERS);
      expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Max-Age', MAX_AGE_SECONDS);
      expect(next).toHaveBeenCalled();
    });

    it('should include Authorization, X-Api-Key, Content-Type, and Idempotency-Key in allowed headers', () => {
      expect(ALLOWED_HEADERS).toContain('Authorization');
      expect(ALLOWED_HEADERS).toContain('X-Api-Key');
      expect(ALLOWED_HEADERS).toContain('Content-Type');
      expect(ALLOWED_HEADERS).toContain('Idempotency-Key');
      expect(ALLOWED_HEADERS).toContain('Accept');
    });
  });

  describe('Development Environment (localhost:5173)', () => {
    beforeEach(() => {
      config.nodeEnv = 'development';
    });

    it('should allow frontend at http://localhost:5173 with credentials and Vary header', () => {
      req.headers.origin = 'http://localhost:5173';

      corsMiddleware(req, res, next);

      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
      expect(res.headers['vary']).toBe('Origin');
      expect(next).toHaveBeenCalled();
    });

    it('should allow 127.0.0.1 on local dev ports', () => {
      req.headers.origin = 'http://127.0.0.1:5173';

      corsMiddleware(req, res, next);

      expect(res.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5173');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
      expect(next).toHaveBeenCalled();
    });

    it('should respond to OPTIONS preflight with 204 No Content and end', () => {
      req.method = 'OPTIONS';
      req.headers.origin = 'http://localhost:5173';

      corsMiddleware(req, res, next);

      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.end).toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });

    it('should handle non-browser requests without an Origin header cleanly', () => {
      req.headers = {}; // No Origin header (e.g. backend curl or internal call)

      corsMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('Production Environment Restrictions', () => {
    const originalNodeEnv = config.nodeEnv;
    const originalAllowedOrigins = config.cors.allowedOrigins;

    beforeEach(() => {
      config.nodeEnv = 'production';
      config.cors.allowedOrigins = ['https://app.hookforge.com', 'https://admin.hookforge.com'];
    });

    afterEach(() => {
      config.nodeEnv = originalNodeEnv;
      config.cors.allowedOrigins = originalAllowedOrigins;
    });

    it('should allow an explicitly whitelisted production origin', () => {
      req.headers.origin = 'https://app.hookforge.com';

      corsMiddleware(req, res, next);

      expect(res.headers['access-control-allow-origin']).toBe('https://app.hookforge.com');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
      expect(res.headers['vary']).toBe('Origin');
      expect(next).toHaveBeenCalled();
    });

    it('should NOT allow unauthorized origins in production', () => {
      req.headers.origin = 'https://malicious-website.com';

      corsMiddleware(req, res, next);

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      expect(next).toHaveBeenCalled();
    });

    it('should reject OPTIONS preflights from unauthorized origins in production with 403', () => {
      req.method = 'OPTIONS';
      req.headers.origin = 'https://malicious-website.com';

      corsMiddleware(req, res, next);

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Forbidden',
        message: 'CORS origin not allowed',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should never use unrestricted wildcard "*" in production', () => {
      // In production, isOriginAllowed must never permit '*'
      expect(isOriginAllowed('*', true, ['*'])).toBe(false);
      expect(isOriginAllowed('https://anywhere.com', true, ['*'])).toBe(false);
    });
  });

  describe('isOriginAllowed Helper', () => {
    it('returns false for empty origin', () => {
      expect(isOriginAllowed('', false)).toBe(false);
      expect(isOriginAllowed(null, false)).toBe(false);
      expect(isOriginAllowed(undefined, true)).toBe(false);
    });

    it('allows configured origins in production', () => {
      const allowed = ['https://hookforge.io'];
      expect(isOriginAllowed('https://hookforge.io', true, allowed)).toBe(true);
      expect(isOriginAllowed('https://other.com', true, allowed)).toBe(false);
      expect(isOriginAllowed('http://localhost:5173', true, allowed)).toBe(false);
    });

    it('allows localhost and 127.0.0.1 in non-production mode', () => {
      expect(isOriginAllowed('http://localhost:5173', false, [])).toBe(true);
      expect(isOriginAllowed('http://localhost:3000', false, [])).toBe(true);
      expect(isOriginAllowed('http://127.0.0.1:8080', false, [])).toBe(true);
      expect(isOriginAllowed('https://malicious.com', false, [])).toBe(false);
    });

    it('handles malformed origin strings without throwing', () => {
      expect(isOriginAllowed('not-a-valid-url', false, [])).toBe(false);
      expect(isOriginAllowed(':::://bad', false, [])).toBe(false);
    });
  });
});
