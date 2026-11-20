/**
 * Integration & API route tests for Endpoint Testing.
 * Covers POST /endpoints/:id/test and POST /endpoints/test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import endpointsRouter from '../../src/routes/endpoints.js';
import endpointService from '../../src/services/endpoint/endpointService.js';
import { NotFoundError, ValidationError } from '../../src/middleware/errorHandler.js';

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
  testEndpoint: vi.fn(),
}));

let mockAuthenticated = true;
const mockTenantId = '123e4567-e89b-12d3-a456-426614174000';
const mockEndpointId = '987e6543-e89b-12d3-a456-426614174999';

vi.mock('../../src/middleware/auth.js', () => ({
  apiKeyAuth: (req, res, next) => {
    if (!mockAuthenticated) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Invalid or missing API key' });
    }
    req.tenantId = '123e4567-e89b-12d3-a456-426614174000';
    next();
  },
  TENANT_ID_ATTRIBUTE: 'tenantId',
}));

describe('Endpoint Testing Routes', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticated = true;
    app = express();
    app.use(express.json());
    app.use('/endpoints', endpointsRouter);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('POST /endpoints/:id/test', () => {
    it('returns 200 with test results for existing endpoint', async () => {
      const mockResult = {
        success: true,
        statusCode: 200,
        status_code: 200,
        latencyMs: 38,
        latency_ms: 38,
        error: null,
        request: {
          url: 'https://example.com/webhook',
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          payload: { event: 'endpoint.test' },
        },
        response: {
          statusCode: 200,
          status_code: 200,
          headers: { 'content-type': 'application/json' },
          body: '{"received":true}',
          sizeBytes: 17,
          size_bytes: 17,
          truncated: false,
        },
        testedAt: new Date().toISOString(),
        tested_at: new Date().toISOString(),
      };

      endpointService.testEndpoint.mockResolvedValue(mockResult);

      const response = await request(app)
        .post(`/endpoints/${mockEndpointId}/test`)
        .send({
          method: 'POST',
          payload: { hello: 'world' },
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.statusCode).toBe(200);
      expect(response.body.response.body).toBe('{"received":true}');
      expect(endpointService.testEndpoint).toHaveBeenCalledWith(
        mockTenantId,
        expect.objectContaining({
          endpointId: mockEndpointId,
          method: 'POST',
          payload: { hello: 'world' },
        })
      );
    });

    it('returns 404 Not Found when endpoint is missing or belongs to another tenant', async () => {
      endpointService.testEndpoint.mockRejectedValue(new NotFoundError('Endpoint not found'));

      const response = await request(app)
        .post(`/endpoints/${mockEndpointId}/test`)
        .send({})
        .expect(404);

      expect(response.body.error).toBe('Not Found');
      expect(response.body.message).toBe('Endpoint not found');
    });

    it('returns 400 Validation Error for invalid UUID in path', async () => {
      const response = await request(app)
        .post('/endpoints/not-a-valid-uuid/test')
        .send({})
        .expect(400);

      expect(response.body.error).toBe('Validation Error');
      expect(response.body.message).toMatch(/Invalid endpoint ID/);
    });

    it('returns 400 Validation Error when service rejects invalid configuration', async () => {
      endpointService.testEndpoint.mockRejectedValue(
        new ValidationError("Invalid HTTP method 'FOO'")
      );

      const response = await request(app)
        .post(`/endpoints/${mockEndpointId}/test`)
        .send({ method: 'FOO' })
        .expect(400);

      expect(response.body.error).toBe('Validation Error');
      expect(response.body.message).toBe("Invalid HTTP method 'FOO'");
    });

    it('returns 401 Unauthorized when unauthenticated', async () => {
      mockAuthenticated = false;

      await request(app)
        .post(`/endpoints/${mockEndpointId}/test`)
        .send({})
        .expect(401);
    });
  });

  describe('POST /endpoints/test', () => {
    it('returns 200 with test results for ad-hoc URL', async () => {
      const mockResult = {
        success: true,
        statusCode: 200,
        status_code: 200,
        latencyMs: 25,
        latency_ms: 25,
        error: null,
        request: {
          url: 'https://example.com/test-target',
          method: 'POST',
          headers: {},
          payload: { test: true },
        },
        response: {
          statusCode: 200,
          status_code: 200,
          headers: {},
          body: 'OK',
          sizeBytes: 2,
          size_bytes: 2,
          truncated: false,
        },
        testedAt: new Date().toISOString(),
        tested_at: new Date().toISOString(),
      };

      endpointService.testEndpoint.mockResolvedValue(mockResult);

      const response = await request(app)
        .post('/endpoints/test')
        .send({
          url: 'https://example.com/test-target',
          method: 'POST',
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.request.url).toBe('https://example.com/test-target');
      expect(endpointService.testEndpoint).toHaveBeenCalledWith(
        mockTenantId,
        expect.objectContaining({
          url: 'https://example.com/test-target',
          method: 'POST',
        })
      );
    });

    it('returns 200 when endpointId is supplied in body', async () => {
      const mockResult = {
        success: true,
        statusCode: 200,
        status_code: 200,
        latencyMs: 15,
        latency_ms: 15,
        error: null,
        request: { url: 'https://example.com/webhook', method: 'GET', headers: {}, payload: null },
        response: null,
        testedAt: new Date().toISOString(),
        tested_at: new Date().toISOString(),
      };

      endpointService.testEndpoint.mockResolvedValue(mockResult);

      const response = await request(app)
        .post('/endpoints/test')
        .send({
          endpointId: mockEndpointId,
          method: 'GET',
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(endpointService.testEndpoint).toHaveBeenCalledWith(
        mockTenantId,
        expect.objectContaining({
          endpointId: mockEndpointId,
          method: 'GET',
        })
      );
    });

    it('returns 400 for malformed URL parameter', async () => {
      const response = await request(app)
        .post('/endpoints/test')
        .send({
          url: 'not-a-valid-url',
        })
        .expect(400);

      expect(response.body.error).toBe('Validation Error');
      expect(response.body.message).toMatch(/URL must be a valid HTTP or HTTPS URL/);
    });

    it('returns 400 for invalid timeout parameter', async () => {
      const response = await request(app)
        .post('/endpoints/test')
        .send({
          url: 'https://example.com/webhook',
          timeoutMs: -5,
        })
        .expect(400);

      expect(response.body.error).toBe('Validation Error');
      expect(response.body.message).toMatch(/timeoutMs/);
    });

    it('returns 400 when service rejects SSRF attempt', async () => {
      endpointService.testEndpoint.mockRejectedValue(
        new ValidationError("SSRF validation failed: Destination IP '10.0.0.1' is blocked")
      );

      const response = await request(app)
        .post('/endpoints/test')
        .send({
          url: 'https://internal-server.corp/hook',
        })
        .expect(400);

      expect(response.body.error).toBe('Validation Error');
      expect(response.body.message).toMatch(/Destination IP '10.0.0.1' is blocked/);
    });

    it('returns 401 Unauthorized when unauthenticated', async () => {
      mockAuthenticated = false;

      await request(app)
        .post('/endpoints/test')
        .send({
          url: 'https://example.com/webhook',
        })
        .expect(401);
    });
  });
});
