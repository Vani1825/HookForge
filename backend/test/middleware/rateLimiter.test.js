/**
 * Unit tests for rate limiting middleware:
 * - getClientIp helper (trust proxy, IPv4, IPv6, malformed IPs)
 * - authRateLimiter (pre-auth IP protection against brute-force attacks)
 * - tenantRateLimiter (per-tenant quota isolation)
 * - healthRateLimiter (health check connection protection)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  getClientIp,
  recordAuthFailure,
  authRateLimiter,
  tenantRateLimiter,
  healthRateLimiter,
} from '../../src/middleware/rateLimiter.js';
import { MemoryRateLimitStore } from '../../src/services/rateLimit/rateLimitStore.js';
import config from '../../src/config/index.js';
import clock from '../../src/utils/clock.js';
import { errorHandler } from '../../src/middleware/errorHandler.js';

describe('Rate Limiter Middleware', () => {
  let testClock;
  let customStore;

  beforeEach(() => {
    testClock = clock.test(1000000);
    customStore = new MemoryRateLimitStore({ clock: testClock, cleanupIntervalMs: 0 });
  });

  afterEach(() => {
    customStore.destroy();
  });

  describe('getClientIp', () => {
    it('should extract standard IPv4 address', () => {
      const req = { ip: '192.0.2.1' };
      expect(getClientIp(req)).toBe('192.0.2.1');
    });

    it('should normalize IPv4-mapped IPv6 address', () => {
      const req = { ip: '::ffff:192.0.2.1' };
      expect(getClientIp(req)).toBe('192.0.2.1');
    });

    it('should extract standard IPv6 address', () => {
      const req = { ip: '2001:db8::1' };
      expect(getClientIp(req)).toBe('2001:db8::1');
    });

    it('should fall back to socket.remoteAddress if req.ip is unset', () => {
      const req = { socket: { remoteAddress: '198.51.100.1' } };
      expect(getClientIp(req)).toBe('198.51.100.1');
    });

    it('should safely return "unknown" when req is null or undefined', () => {
      expect(getClientIp(null)).toBe('unknown');
      expect(getClientIp(undefined)).toBe('unknown');
    });

    it('should safely return "unknown" when IP is missing or not a string', () => {
      expect(getClientIp({})).toBe('unknown');
      expect(getClientIp({ ip: null })).toBe('unknown');
      expect(getClientIp({ ip: 12345 })).toBe('unknown');
      expect(getClientIp({ ip: '' })).toBe('unknown');
    });

    it('should safely return "unknown" for malformed or injected IP strings', () => {
      expect(getClientIp({ ip: 'not-an-ip-address' })).toBe('unknown');
      expect(getClientIp({ ip: '999.999.999.999' })).toBe('unknown');
      expect(getClientIp({ ip: '127.0.0.1; DROP TABLE;' })).toBe('unknown');
    });

    it('should NOT trust spoofed X-Forwarded-For headers when trust proxy is false', async () => {
      const app = express();
      app.set('trust proxy', false);
      let capturedIp = null;
      app.get('/test-ip', (req, res) => {
        capturedIp = getClientIp(req);
        res.json({ ip: capturedIp });
      });

      await request(app)
        .get('/test-ip')
        .set('X-Forwarded-For', '203.0.113.199');

      // Express with trust proxy false reads the actual TCP socket connection address (127.0.0.1)
      expect(capturedIp).not.toBe('203.0.113.199');
      expect(['127.0.0.1', '::1', 'unknown']).toContain(capturedIp);
    });
  });

  describe('authRateLimiter', () => {
    it('should allow requests when below failed authentication limit', async () => {
      const app = express();
      app.use(authRateLimiter({ store: customStore }));
      app.get('/protected', (req, res) => res.json({ ok: true }));

      const res = await request(app).get('/protected');
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('should return HTTP 429 with Retry-After when IP has reached failed auth limit', async () => {
      const clientIp = '198.51.100.50';
      const { limit } = config.rateLimit.authFail;

      // Simulate reaching failure limit
      for (let i = 0; i < limit; i++) {
        await recordAuthFailure(clientIp, customStore);
      }

      const app = express();
      app.use((req, res, next) => {
        Object.defineProperty(req, 'ip', { value: clientIp, configurable: true });
        next();
      });
      app.use(authRateLimiter({ store: customStore }));
      app.use(errorHandler);
      app.get('/protected', (req, res) => res.json({ ok: true }));

      const response = await request(app).get('/protected');

      expect(response.status).toBe(429);
      expect(response.headers['retry-after']).toBeDefined();
      expect(Number(response.headers['retry-after'])).toBeGreaterThanOrEqual(1);
      expect(response.body).toEqual({
        error: {
          type: 'rate_limit_exceeded',
          message: 'Too many failed authentication attempts. Please try again later.',
        },
      });
    });
  });

  describe('tenantRateLimiter', () => {
    it('should limit tenant requests exceeding configured quota', async () => {
      const tenantId = 'tenant-xyz';
      const originalLimit = config.rateLimit.tenant.limit;

      try {
        config.rateLimit.tenant.limit = 3;

        const app = express();
        app.use((req, res, next) => {
          req.tenantId = tenantId;
          next();
        });
        app.use(tenantRateLimiter({ store: customStore }));
        app.get('/events', (req, res) => res.json({ ok: true }));

        // 3 requests allowed
        for (let i = 0; i < 3; i++) {
          const res = await request(app).get('/events');
          expect(res.status).toBe(200);
        }

        // 4th request throttled with 429
        const throttledRes = await request(app).get('/events');
        expect(throttledRes.status).toBe(429);
        expect(throttledRes.headers['retry-after']).toBeDefined();
        expect(throttledRes.body).toEqual({
          error: {
            type: 'rate_limit_exceeded',
            message: 'Too many requests for tenant. Please try again later.',
          },
        });
      } finally {
        config.rateLimit.tenant.limit = originalLimit;
      }
    });

    it('should isolate rate limits across different tenants', async () => {
      const originalLimit = config.rateLimit.tenant.limit;

      try {
        config.rateLimit.tenant.limit = 2;

        const app = express();
        app.use((req, res, next) => {
          req.tenantId = req.headers['x-test-tenant'];
          next();
        });
        app.use(tenantRateLimiter({ store: customStore }));
        app.get('/events', (req, res) => res.json({ ok: true }));

        // Exhaust Tenant A
        await request(app).get('/events').set('x-test-tenant', 'tenant-a');
        await request(app).get('/events').set('x-test-tenant', 'tenant-a');
        const resA3 = await request(app).get('/events').set('x-test-tenant', 'tenant-a');
        expect(resA3.status).toBe(429);

        // Tenant B must not be affected by Tenant A's usage
        const resB1 = await request(app).get('/events').set('x-test-tenant', 'tenant-b');
        expect(resB1.status).toBe(200);
      } finally {
        config.rateLimit.tenant.limit = originalLimit;
      }
    });

    it('should pass unauthenticated requests without error', async () => {
      const app = express();
      // No req.tenantId set
      app.use(tenantRateLimiter({ store: customStore }));
      app.get('/public', (req, res) => res.json({ public: true }));

      const response = await request(app).get('/public');
      expect(response.status).toBe(200);
      expect(response.body.public).toBe(true);
    });

    it('should ignore client-supplied query tenantId', async () => {
      const app = express();
      app.use((req, res, next) => {
        req.tenantId = 'auth-tenant-1';
        next();
      });
      app.use(tenantRateLimiter({ store: customStore }));
      app.get('/events', (req, res) => res.json({ ok: true }));

      await request(app).get('/events?tenantId=spoofed-tenant-2');

      // The permit was recorded for auth-tenant-1, NOT spoofed-tenant-2
      const authStatus = await customStore.get('tenant', 'auth-tenant-1', 100, 1000);
      expect(authStatus.current).toBe(1);

      const spoofStatus = await customStore.get('tenant', 'spoofed-tenant-2', 100, 1000);
      expect(spoofStatus.current).toBe(0);
    });
  });

  describe('healthRateLimiter', () => {
    it('should allow requests within limit and preserve health check contract', async () => {
      const app = express();
      app.use(healthRateLimiter({ store: customStore }));
      app.get('/health', (req, res) => {
        res.json({
          status: 'up',
          timestamp: new Date().toISOString(),
          checks: { database: { status: 'up' } },
        });
      });

      const response = await request(app).get('/health');
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('up');
      expect(response.body.checks.database.status).toBe('up');
    });

    it('should throttle requests exceeding health check limit with HTTP 429', async () => {
      const originalLimit = config.rateLimit.health.limit;

      try {
        config.rateLimit.health.limit = 2;

        const app = express();
        app.use(healthRateLimiter({ store: customStore }));
        app.get('/health', (req, res) => res.json({ status: 'up' }));

        await request(app).get('/health');
        await request(app).get('/health');

        const throttled = await request(app).get('/health');
        expect(throttled.status).toBe(429);
        expect(throttled.headers['retry-after']).toBeDefined();
        expect(throttled.body).toEqual({
          error: {
            type: 'rate_limit_exceeded',
            message: 'Too many health check requests. Please try again later.',
          },
        });
      } finally {
        config.rateLimit.health.limit = originalLimit;
      }
    });

    it('should isolate health counters from tenant and auth counters', async () => {
      const ip = '127.0.0.1';
      await customStore.consume('health', ip, 30, 60000);

      const healthStatus = await customStore.get('health', ip, 30, 60000);
      expect(healthStatus.current).toBe(1);

      const authStatus = await customStore.get('auth_fail', ip, 10, 60000);
      expect(authStatus.current).toBe(0);

      const tenantStatus = await customStore.get('tenant', ip, 100, 1000);
      expect(tenantStatus.current).toBe(0);
    });
  });

  describe('pipeline execution order & regression tests', () => {
    it('should reject requests exceeding IP limit BEFORE JSON parsing', async () => {
      const clientIp = '198.51.100.99';
      for (let i = 0; i < config.rateLimit.authFail.limit; i++) {
        await recordAuthFailure(clientIp, customStore);
      }

      let jsonParserCalled = false;
      const trackingJsonParser = (req, res, next) => {
        jsonParserCalled = true;
        express.json({ limit: config.ingest.maxPayloadBytes })(req, res, next);
      };

      const app = express();
      app.use((req, res, next) => {
        Object.defineProperty(req, 'ip', { value: clientIp, configurable: true });
        next();
      });
      // Pipeline: IP limiter runs BEFORE JSON parsing
      app.use(authRateLimiter({ store: customStore }));
      app.use(trackingJsonParser);
      app.use(errorHandler);
      app.post('/events', (req, res) => res.status(200).json({ ok: true }));

      // Send a request with malformed / invalid JSON body
      const res = await request(app)
        .post('/events')
        .set('Content-Type', 'application/json')
        .send('{ invalid json syntax ');

      // Should be rejected with 429 by authRateLimiter, NOT 400 SyntaxError from body-parser
      expect(res.status).toBe(429);
      expect(res.body.error.type).toBe('rate_limit_exceeded');
      expect(jsonParserCalled).toBe(false);
    });

    it('should return HTTP 413 for oversized requests when within IP quota', async () => {
      const clientIp = '198.51.100.101';
      const originalLimit = config.ingest.maxPayloadBytes;

      try {
        config.ingest.maxPayloadBytes = 1024;
        const app = express();
        app.use((req, res, next) => {
          Object.defineProperty(req, 'ip', { value: clientIp, configurable: true });
          next();
        });
        // Pipeline: IP limiter -> JSON parser
        app.use(authRateLimiter({ store: customStore }));
        app.use(express.json({ limit: config.ingest.maxPayloadBytes }));
        app.use(errorHandler);
        app.post('/events', (req, res) => res.status(200).json({ ok: true }));

        const res = await request(app)
          .post('/events')
          .set('Content-Type', 'application/json')
          .send(JSON.stringify({ data: 'x'.repeat(2048) }));

        expect(res.status).toBe(413);
        expect(res.body.error.type).toBe('payload_too_large');
      } finally {
        config.ingest.maxPayloadBytes = originalLimit;
      }
    });
  });
});
