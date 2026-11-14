/**
 * Unit tests for ApiKeyAuthFilter middleware.
 * Tests authentication with mocked tenant repository.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiKeyAuth, TENANT_ID_ATTRIBUTE } from '../../src/middleware/auth.js';
import { defaultRateLimitStore } from '../../src/services/rateLimit/rateLimitStore.js';

// Mock the tenant repository
vi.mock('../../src/repositories/jdbc/tenantRepository.js', () => ({
  default: {
    findByApiKeyHash: vi.fn(),
  },
}));

// Mock the logger
vi.mock('../../src/utils/logger.js', () => ({
  default: {
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

describe('ApiKeyAuthFilter', () => {
  let req, res, next;

  beforeEach(async () => {
    vi.clearAllMocks();
    await defaultRateLimitStore.reset();
    req = {
      path: '/api/test',
      method: 'GET',
      headers: {},
      ip: '127.0.0.1',
    };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      setHeader: vi.fn().mockReturnThis(),
    };
    next = vi.fn();
  });

  describe('bypass paths', () => {
    it('should bypass authentication for /health path', async () => {
      req.path = '/health';

      await apiKeyAuth(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should NOT bypass /health subpaths (exact match only)', async () => {
      req.path = '/health/something';
      req.headers.authorization = 'Bearer test-key';

      await apiKeyAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('should bypass authentication for /actuator path', async () => {
      req.path = '/actuator/prometheus';

      await apiKeyAuth(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should bypass authentication for /actuator subpaths', async () => {
      req.path = '/actuator/health';

      await apiKeyAuth(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('missing Authorization header', () => {
    it('should return 401 when Authorization header is missing', async () => {
      req.headers = {};

      await apiKeyAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Missing Authorization header',
      });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('invalid Authorization scheme', () => {
    it('should return 401 when Authorization header does not use Bearer scheme', async () => {
      req.headers.authorization = 'Basic abc123';

      await apiKeyAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Authorization header must use Bearer scheme',
      });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('empty API key', () => {
    it('should return 401 when API key is empty with trailing space', async () => {
      req.headers.authorization = 'Bearer ';

      await apiKeyAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Empty API key',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 when Authorization header is literally "Bearer"', async () => {
      req.headers.authorization = 'Bearer';

      await apiKeyAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Empty API key',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 when Authorization header has only whitespace after Bearer', async () => {
      req.headers.authorization = 'Bearer    ';

      await apiKeyAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Empty API key',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 when X-Api-Key is empty', async () => {
      req.headers['x-api-key'] = '   ';

      await apiKeyAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Empty API key',
      });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('valid API key', () => {
    it('should authenticate and set tenantId when API key is valid', async () => {
      const tenantRepository = await import(
        '../../src/repositories/jdbc/tenantRepository.js'
      );
      const mockTenant = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Test Tenant',
      };

      tenantRepository.default.findByApiKeyHash.mockResolvedValue(mockTenant);
      req.headers.authorization = 'Bearer valid-api-key';

      await apiKeyAuth(req, res, next);

      expect(tenantRepository.default.findByApiKeyHash).toHaveBeenCalled();
      expect(req[TENANT_ID_ATTRIBUTE]).toBe(mockTenant.id);
      expect(req.tenantId).toBe(mockTenant.id);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should authenticate with case-insensitive scheme "bearer"', async () => {
      const tenantRepository = await import(
        '../../src/repositories/jdbc/tenantRepository.js'
      );
      const mockTenant = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Test Tenant',
      };

      tenantRepository.default.findByApiKeyHash.mockResolvedValue(mockTenant);
      req.headers.authorization = 'bearer case-insensitive-key';

      await apiKeyAuth(req, res, next);

      expect(tenantRepository.default.findByApiKeyHash).toHaveBeenCalled();
      expect(req[TENANT_ID_ATTRIBUTE]).toBe(mockTenant.id);
      expect(next).toHaveBeenCalled();
    });

    it('should authenticate with X-Api-Key header', async () => {
      const tenantRepository = await import(
        '../../src/repositories/jdbc/tenantRepository.js'
      );
      const mockTenant = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Test Tenant',
      };

      tenantRepository.default.findByApiKeyHash.mockResolvedValue(mockTenant);
      req.headers['x-api-key'] = 'x-key-12345';

      await apiKeyAuth(req, res, next);

      expect(tenantRepository.default.findByApiKeyHash).toHaveBeenCalled();
      expect(req[TENANT_ID_ATTRIBUTE]).toBe(mockTenant.id);
      expect(req.tenantId).toBe(mockTenant.id);
      expect(next).toHaveBeenCalled();
    });

    it('should handle array authorization headers cleanly', async () => {
      const tenantRepository = await import(
        '../../src/repositories/jdbc/tenantRepository.js'
      );
      const mockTenant = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Test Tenant',
      };

      tenantRepository.default.findByApiKeyHash.mockResolvedValue(mockTenant);
      req.headers.authorization = ['Bearer array-key'];

      await apiKeyAuth(req, res, next);

      expect(tenantRepository.default.findByApiKeyHash).toHaveBeenCalled();
      expect(req[TENANT_ID_ATTRIBUTE]).toBe(mockTenant.id);
      expect(next).toHaveBeenCalled();
    });

    it('should bypass repository lookup if request is already authenticated', async () => {
      const tenantRepository = await import(
        '../../src/repositories/jdbc/tenantRepository.js'
      );

      req.tenantId = 'pre-existing-tenant';

      await apiKeyAuth(req, res, next);

      expect(tenantRepository.default.findByApiKeyHash).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });
  });

  describe('invalid API key', () => {
    it('should return 401 when API key is invalid (tenant not found)', async () => {
      const tenantRepository = await import(
        '../../src/repositories/jdbc/tenantRepository.js'
      );

      tenantRepository.default.findByApiKeyHash.mockResolvedValue(null);
      req.headers.authorization = 'Bearer invalid-api-key';

      await apiKeyAuth(req, res, next);

      expect(tenantRepository.default.findByApiKeyHash).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Invalid API key',
      });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('repository failure', () => {
    it('should return 500 when repository lookup fails', async () => {
      const tenantRepository = await import(
        '../../src/repositories/jdbc/tenantRepository.js'
      );

      tenantRepository.default.findByApiKeyHash.mockRejectedValue(
        new Error('Database connection failed')
      );
      req.headers.authorization = 'Bearer some-key';

      await apiKeyAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Internal Server Error',
        message: 'Authentication failed',
      });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('API key hashing', () => {
    it('should hash API key before repository lookup', async () => {
      const tenantRepository = await import(
        '../../src/repositories/jdbc/tenantRepository.js'
      );

      tenantRepository.default.findByApiKeyHash.mockResolvedValue({
        id: 'tenant-id',
        name: 'Test',
      });
      req.headers.authorization = 'Bearer test-api-key';

      await apiKeyAuth(req, res, next);

      // Verify that findByApiKeyHash was called (it receives the hash, not the raw key)
      expect(tenantRepository.default.findByApiKeyHash).toHaveBeenCalled();
      // The hash should be different from the raw key
      const calledWithHash = tenantRepository.default.findByApiKeyHash.mock.calls[0][0];
      expect(calledWithHash).not.toBe('test-api-key');
      expect(calledWithHash).toHaveLength(64); // SHA-256 hex is 64 characters
    });
  });

  describe('failed authentication rate limiting', () => {
    it('should throttle invalid API-key floods before repeated database lookups', async () => {
      const tenantRepository = await import(
        '../../src/repositories/jdbc/tenantRepository.js'
      );
      tenantRepository.default.findByApiKeyHash.mockResolvedValue(null);

      // Perform 10 failed authentication attempts
      for (let i = 0; i < 10; i++) {
        req.headers.authorization = `Bearer invalid-key-${i}`;
        await apiKeyAuth(req, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
      }

      expect(tenantRepository.default.findByApiKeyHash).toHaveBeenCalledTimes(10);
      tenantRepository.default.findByApiKeyHash.mockClear();
      vi.clearAllMocks();

      // The 11th request from the same IP must be throttled with HTTP 429
      req.headers.authorization = 'Bearer invalid-key-11';
      await apiKeyAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(String));
      expect(res.json).toHaveBeenCalledWith({
        error: {
          type: 'rate_limit_exceeded',
          message: 'Too many failed authentication attempts. Please try again later.',
        },
      });
      // CRITICAL: Database must NOT be queried for throttled request
      expect(tenantRepository.default.findByApiKeyHash).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });

    it('should isolate failed authentication counters by client IP', async () => {
      const tenantRepository = await import(
        '../../src/repositories/jdbc/tenantRepository.js'
      );
      tenantRepository.default.findByApiKeyHash.mockResolvedValue(null);

      // 10 failures from IP A (10.0.0.1)
      req.ip = '10.0.0.1';
      for (let i = 0; i < 10; i++) {
        req.headers.authorization = `Bearer bad-key-${i}`;
        await apiKeyAuth(req, res, next);
      }

      // Request from IP A is throttled (429)
      vi.clearAllMocks();
      await apiKeyAuth(req, res, next);
      expect(res.status).toHaveBeenCalledWith(429);

      // Request from IP B (10.0.0.2) is NOT throttled and proceeds to auth check
      vi.clearAllMocks();
      req.ip = '10.0.0.2';
      tenantRepository.default.findByApiKeyHash.mockResolvedValue({ id: 'tenant-b' });
      req.headers.authorization = 'Bearer valid-key-b';
      await apiKeyAuth(req, res, next);

      expect(res.status).not.toHaveBeenCalledWith(429);
      expect(next).toHaveBeenCalled();
      expect(req.tenantId).toBe('tenant-b');
    });
  });
});
