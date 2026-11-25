/**
 * Integration tests for endpoint routes.
 * Tests full request/response cycle with supertest.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import endpointsRouter from '../../src/routes/endpoints.js';

vi.mock('../../src/repositories/jdbc/endpointRepository.js', () => ({
  default: {
    insert: vi.fn(),
    findByIdAndTenant: vi.fn(),
    findAllByTenant: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('../../src/services/endpoint/endpointService.js', () => ({
  default: {
    create: vi.fn(),
    list: vi.fn(),
    getById: vi.fn(),
    update: vi.fn(),
    get: vi.fn(),
    remove: vi.fn(),
    testEndpoint: vi.fn(),
  },
}));

vi.mock('../../src/middleware/auth.js', () => ({
  apiKeyAuth: (req, res, next) => {
    req.tenantId = '123e4567-e89b-12d3-a456-426614174000';
    next();
  },
  TENANT_ID_ATTRIBUTE: 'tenantId',
}));

describe('Endpoint Routes', () => {
  let app;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/endpoints', endpointsRouter);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mockTenantId = '123e4567-e89b-12d3-a456-426614174000';
  const mockEndpointId = '987e6543-e89b-12d3-a456-426614174999';

  describe('POST /endpoints', () => {
    it('should create endpoint and return 201 with secret', async () => {
      const endpointService = (await import('../../src/services/endpoint/endpointService.js')).default;
      const mockEndpoint = {
        id: mockEndpointId,
        url: 'https://example.com/webhook',
        secret: 'whsec_test123',
        active: true,
        rateLimitRps: 10,
        circuitState: 'CLOSED',
        createdAt: new Date().toISOString(),
      };

      endpointService.create.mockResolvedValue(mockEndpoint);

      const response = await request(app)
        .post('/endpoints')
        .send({
          url: 'https://example.com/webhook',
          rateLimitRps: 10,
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('secret');
      expect(response.body.url).toBe('https://example.com/webhook');
    });

    it('should return 400 for invalid URL', async () => {
      await request(app)
        .post('/endpoints')
        .send({
          url: 'not-a-url',
        })
        .expect(400);
    });

    it('should return 400 for invalid rateLimitRps', async () => {
      await request(app)
        .post('/endpoints')
        .send({
          url: 'https://example.com/webhook',
          rateLimitRps: -1,
        })
        .expect(400);
    });

    it('should return 400 when endpointService rejects SSRF URL', async () => {
      const endpointService = (await import('../../src/services/endpoint/endpointService.js')).default;
      const { ValidationError } = await import('../../src/middleware/errorHandler.js');
      endpointService.create.mockRejectedValueOnce(
        new ValidationError("Destination IP '169.254.169.254' is blocked (cloud metadata address)")
      );

      const response = await request(app)
        .post('/endpoints')
        .send({
          url: 'http://169.254.169.254/latest/meta-data/',
        })
        .expect(400);

      expect(response.body.error).toBe('Validation Error');
      expect(response.body.message).toContain('cloud metadata');
    });

    it('should create endpoint with custom retry policy and return 201', async () => {
      const endpointService = (await import('../../src/services/endpoint/endpointService.js')).default;
      const mockEndpoint = {
        id: mockEndpointId,
        url: 'https://example.com/webhook',
        secret: 'whsec_test123',
        active: true,
        rateLimitRps: 10,
        circuitState: 'CLOSED',
        retryStrategy: 'FIXED',
        retryMaxAttempts: 5,
        retryBaseDelayMs: 3000,
        retryMaxDelayMs: 3000,
        retryBackoffMultiplier: 1.0,
        createdAt: new Date().toISOString(),
      };

      endpointService.create.mockResolvedValue(mockEndpoint);

      const response = await request(app)
        .post('/endpoints')
        .send({
          url: 'https://example.com/webhook',
          retryStrategy: 'FIXED',
          retryMaxAttempts: 5,
          retryBaseDelayMs: 3000,
        })
        .expect(201);

      expect(response.body.retryStrategy).toBe('FIXED');
      expect(response.body.retryMaxAttempts).toBe(5);
      expect(response.body.retryBaseDelayMs).toBe(3000);
      expect(response.body.retryPolicy).toEqual({
        strategy: 'FIXED',
        maxAttempts: 5,
        baseDelayMs: 3000,
        maxDelayMs: 3000,
        backoffMultiplier: 1.0,
      });
    });

    it('should return 400 for invalid retryStrategy on create', async () => {
      const response = await request(app)
        .post('/endpoints')
        .send({
          url: 'https://example.com/webhook',
          retryStrategy: 'INVALID_STRATEGY',
        })
        .expect(400);

      expect(response.body.error).toBe('Validation Error');
      expect(response.body.message).toContain('retryStrategy');
    });

    it('should return 400 for invalid retryMaxAttempts on create', async () => {
      const response = await request(app)
        .post('/endpoints')
        .send({
          url: 'https://example.com/webhook',
          retryMaxAttempts: 0,
        })
        .expect(400);

      expect(response.body.error).toBe('Validation Error');
      expect(response.body.message).toContain('retryMaxAttempts');
    });

    it('should return 400 when endpointService rejects invalid retry configuration', async () => {
      const endpointService = (await import('../../src/services/endpoint/endpointService.js')).default;
      const { ValidationError } = await import('../../src/middleware/errorHandler.js');
      endpointService.create.mockRejectedValueOnce(
        new ValidationError('retryMaxDelayMs must be greater than or equal to retryBaseDelayMs')
      );

      const response = await request(app)
        .post('/endpoints')
        .send({
          url: 'https://example.com/webhook',
          retryBaseDelayMs: 10000,
          retryMaxDelayMs: 5000,
        })
        .expect(400);

      expect(response.body.error).toBe('Validation Error');
      expect(response.body.message).toContain('retryMaxDelayMs must be greater than or equal to retryBaseDelayMs');
    });
  });

  describe('GET /endpoints', () => {
    it('should list endpoints without secret', async () => {
      const endpointService = (await import('../../src/services/endpoint/endpointService.js')).default;
      const mockEndpoints = [
        {
          id: mockEndpointId,
          url: 'https://example.com/webhook',
          active: true,
          rateLimitRps: 10,
          circuitState: 'CLOSED',
          createdAt: new Date().toISOString(),
        },
      ];

      endpointService.list.mockResolvedValue(mockEndpoints);

      const response = await request(app)
        .get('/endpoints')
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0]).toHaveProperty('url');
      expect(response.body[0]).not.toHaveProperty('secret');
    });
  });

  describe('GET /endpoints/:id', () => {
    it('should return endpoint DTO without secret when found', async () => {
      const endpointService = (await import('../../src/services/endpoint/endpointService.js')).default;
      const mockEndpoint = {
        id: mockEndpointId,
        url: 'https://example.com/webhook',
        active: true,
        rateLimitRps: 10,
        rate_limit_rps: 10,
        circuitState: 'CLOSED',
        circuit_state: 'CLOSED',
        consecutiveFailures: 0,
        consecutive_failures: 0,
        nextSeq: 1,
        next_seq: 1,
        createdAt: new Date().toISOString(),
        created_at: new Date().toISOString(),
      };

      endpointService.getById.mockResolvedValue(mockEndpoint);

      const response = await request(app)
        .get(`/endpoints/${mockEndpointId}`)
        .expect(200);

      expect(endpointService.getById).toHaveBeenCalledWith(mockTenantId, mockEndpointId);
      expect(response.body.id).toBe(mockEndpointId);
      expect(response.body.url).toBe('https://example.com/webhook');
      expect(response.body).not.toHaveProperty('secret');
    });

    it('should return 404 when endpoint not found', async () => {
      const endpointService = (await import('../../src/services/endpoint/endpointService.js')).default;
      endpointService.getById.mockResolvedValue(null);

      await request(app)
        .get(`/endpoints/${mockEndpointId}`)
        .expect(404);
    });

    it('should return 400 for invalid endpoint ID format', async () => {
      await request(app)
        .get('/endpoints/invalid-uuid')
        .expect(400);
    });
  });

  describe('PATCH /endpoints/:id', () => {
    it('should update endpoint and return 200', async () => {
      const endpointService = (await import('../../src/services/endpoint/endpointService.js')).default;
      const mockUpdated = {
        id: mockEndpointId,
        url: 'https://example.com/new-url',
        active: false,
        rateLimitRps: 20,
        circuitState: 'CLOSED',
        createdAt: new Date().toISOString(),
      };

      endpointService.update.mockResolvedValue(mockUpdated);

      const response = await request(app)
        .patch(`/endpoints/${mockEndpointId}`)
        .send({
          url: 'https://example.com/new-url',
          active: false,
          rateLimitRps: 20,
        })
        .expect(200);

      expect(response.body.url).toBe('https://example.com/new-url');
      expect(response.body.active).toBe(false);
    });

    it('should return 404 when endpoint not found', async () => {
      const endpointService = (await import('../../src/services/endpoint/endpointService.js')).default;
      endpointService.update.mockResolvedValue(null);

      await request(app)
        .patch(`/endpoints/${mockEndpointId}`)
        .send({ url: 'https://example.com/new-url' })
        .expect(404);
    });

    it('should return 400 for invalid endpoint ID', async () => {
      await request(app)
        .patch('/endpoints/not-a-uuid')
        .send({ url: 'https://example.com/new-url' })
        .expect(400);
    });

    it('should update endpoint with custom retry policy and return 200', async () => {
      const endpointService = (await import('../../src/services/endpoint/endpointService.js')).default;
      const mockUpdated = {
        id: mockEndpointId,
        url: 'https://example.com/webhook',
        active: true,
        rateLimitRps: 10,
        circuitState: 'CLOSED',
        retryStrategy: 'FIXED',
        retryMaxAttempts: 3,
        retryBaseDelayMs: 2000,
        createdAt: new Date().toISOString(),
      };

      endpointService.update.mockResolvedValue(mockUpdated);

      const response = await request(app)
        .patch(`/endpoints/${mockEndpointId}`)
        .send({
          retryStrategy: 'FIXED',
          retryMaxAttempts: 3,
          retryBaseDelayMs: 2000,
        })
        .expect(200);

      expect(response.body.retryStrategy).toBe('FIXED');
      expect(response.body.retryMaxAttempts).toBe(3);
    });

    it('should return 400 for invalid retryStrategy on PATCH', async () => {
      const response = await request(app)
        .patch(`/endpoints/${mockEndpointId}`)
        .send({
          retryStrategy: 'INVALID_STRATEGY',
        })
        .expect(400);

      expect(response.body.error).toBe('Validation Error');
      expect(response.body.message).toContain('retryStrategy');
    });
  });

  describe('GET /endpoints/:id', () => {
    it('should return endpoint details when found', async () => {
      const endpointService = (await import('../../src/services/endpoint/endpointService.js')).default;
      const mockEndpoint = {
        id: mockEndpointId,
        url: 'https://example.com/webhook',
        active: true,
        rateLimitRps: 10,
        circuitState: 'CLOSED',
        createdAt: new Date().toISOString(),
      };
      endpointService.get.mockResolvedValue(mockEndpoint);

      const response = await request(app)
        .get(`/endpoints/${mockEndpointId}`)
        .expect(200);

      expect(response.body.id).toBe(mockEndpointId);
      expect(response.body.url).toBe('https://example.com/webhook');
    });

    it('should return 404 when endpoint not found', async () => {
      const endpointService = (await import('../../src/services/endpoint/endpointService.js')).default;
      endpointService.get.mockResolvedValue(null);

      await request(app)
        .get(`/endpoints/${mockEndpointId}`)
        .expect(404);
    });

    it('should return 400 for invalid endpoint ID format', async () => {
      await request(app)
        .get('/endpoints/invalid-uuid')
        .expect(400);
    });
  });

  describe('DELETE /endpoints/:id', () => {
    it('should remove/deactivate endpoint and return 200', async () => {
      const endpointService = (await import('../../src/services/endpoint/endpointService.js')).default;
      endpointService.remove.mockResolvedValue({ success: true, id: mockEndpointId });

      const response = await request(app)
        .delete(`/endpoints/${mockEndpointId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.id).toBe(mockEndpointId);
    });

    it('should return 404 when endpoint not found for delete', async () => {
      const endpointService = (await import('../../src/services/endpoint/endpointService.js')).default;
      endpointService.remove.mockResolvedValue(null);

      await request(app)
        .delete(`/endpoints/${mockEndpointId}`)
        .expect(404);
    });
  });
});
