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
    update: vi.fn(),
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
  });
});
