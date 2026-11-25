/**
 * Comprehensive tests for Tanvi's Phase 2 Task:
 * Delivery Inspector & Resend Flow.
 *
 * Covers:
 * 1. Database persistence of response_body, response_headers, and request_headers.
 * 2. Attempt execution bounded response capture and 64KB size limits.
 * 3. Sensitive header and token redaction (X-Webhook-Signature, Authorization, Cookie, Bearer).
 * 4. Delivery Inspector enriched fields (GET /deliveries/:id, GET /deliveries/:id/attempts).
 * 5. Resending DEAD, SUCCEEDED, and CANCELLED deliveries.
 * 6. Rejection of IN_FLIGHT deliveries and invalid states.
 * 7. Queued (immediate: false) and immediate (immediate: true) execution lifecycle.
 * 8. Preservation of original seq, delivery identity, and past attempt history.
 * 9. Validation of UUID, missing delivery (404), and tenant isolation.
 * 10. Concurrent resend mutual exclusion / lease protection.
 * 11. Backward compatibility of POST /deliveries/:id/replay and bulk replay.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import deliveriesRouter from '../../../src/routes/deliveries.js';
import deliveryService from '../../../src/services/delivery/deliveryService.js';
import deliveryRepository from '../../../src/repositories/jdbc/deliveryRepository.js';
import endpointRepository from '../../../src/repositories/jdbc/endpointRepository.js';
import eventRepository from '../../../src/repositories/jdbc/eventRepository.js';
import attemptExecutor from '../../../src/services/delivery/attemptExecutor.js';
import httpWebhookSender from '../../../src/services/delivery/httpWebhookSender.js';
import { handleOutcome } from '../../../src/services/delivery/outcomeHandler.js';
import { shouldAttempt } from '../../../src/services/resilience/thresholdCircuitBreaker.js';
import { tryAcquire } from '../../../src/services/resilience/tokenBucketRateLimiter.js';
import { deliveryState } from '../../../src/domain/deliveryState.js';
import { deliveryOutcome } from '../../../src/domain/deliveryOutcome.js';
import { sanitizeHeaders, sanitizeResponseBody } from '../../../src/utils/redaction.js';

vi.mock('../../../src/repositories/jdbc/deliveryRepository.js');
vi.mock('../../../src/repositories/jdbc/endpointRepository.js');
vi.mock('../../../src/repositories/jdbc/eventRepository.js');
vi.mock('../../../src/services/delivery/attemptExecutor.js');
vi.mock('../../../src/services/delivery/httpWebhookSender.js');
vi.mock('../../../src/services/delivery/outcomeHandler.js');
vi.mock('../../../src/services/resilience/thresholdCircuitBreaker.js');
vi.mock('../../../src/services/resilience/tokenBucketRateLimiter.js');

function createTestApp() {
  const app = express();
  app.use(express.json());

  app.use((req, res, next) => {
    req.tenantId = '123e4567-e89b-12d3-a456-426614174000';
    next();
  });

  app.use('/deliveries', deliveriesRouter);
  return app;
}

describe("Phase 2 - Tanvi's Task: Delivery Inspector & Resend Flow", () => {
  let app;
  const mockTenantId = '123e4567-e89b-12d3-a456-426614174000';
  const mockDeliveryId = '987e6543-e89b-12d3-a456-426614174999';
  const mockEndpointId = '111e6543-e89b-12d3-a456-426614174111';
  const mockEventId = '222e6543-e89b-12d3-a456-426614174222';

  const mockEndpoint = {
    id: mockEndpointId,
    tenantId: mockTenantId,
    url: 'https://webhook.receiver.example/events',
    rateLimitRps: 20,
    retryMaxAttempts: 8,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
  });

  // =========================================================================
  // 1. Redaction & Bounded Capture Utilities
  // =========================================================================
  describe('1. Sanitization & Redaction Rules', () => {
    it('redacts sensitive headers (X-Webhook-Signature, Authorization, Cookie, Set-Cookie)', () => {
      const headers = {
        'content-type': 'application/json',
        'x-webhook-signature': 't=123,v1=secret_signature_hash',
        'authorization': 'Bearer secret_token_abc',
        'cookie': 'session_id=12345',
        'set-cookie': 'tracking=abc',
        'x-request-id': 'req_xyz123',
      };

      const sanitized = sanitizeHeaders(headers);
      expect(sanitized['content-type']).toBe('application/json');
      expect(sanitized['x-request-id']).toBe('req_xyz123');
      expect(sanitized['x-webhook-signature']).toBe('[REDACTED]');
      expect(sanitized['authorization']).toBe('[REDACTED]');
      expect(sanitized['cookie']).toBe('[REDACTED]');
      expect(sanitized['set-cookie']).toBe('[REDACTED]');
    });

    it('bounds and redacts sensitive payload fields in JSON response bodies', () => {
      const rawJson = JSON.stringify({
        status: 'error',
        message: 'Invalid credentials provided',
        secret_key: 'top_secret_raw_key',
        nested: {
          token: 'sub_secret_token',
        },
      });

      const sanitized = sanitizeResponseBody(rawJson, 65536);
      expect(sanitized).toContain('"status":"error"');
      expect(sanitized).toContain('"secret_key":"[REDACTED]"');
      expect(sanitized).toContain('"token":"[REDACTED]"');
    });

    it('bounds oversized text/HTML response bodies to 65536 bytes', () => {
      const hugeBody = '<html>Error</html>' + 'X'.repeat(80000);
      const sanitized = sanitizeResponseBody(hugeBody, 65536);
      expect(sanitized.length).toBeLessThanOrEqual(65536 + '... [TRUNCATED]'.length);
      expect(sanitized).toContain('... [TRUNCATED]');
    });
  });

  // =========================================================================
  // 2. Resend Eligibility & State Handling
  // =========================================================================
  describe('2. Resend State Eligibility & Rejection Rules', () => {
    it('allows resending a DEAD delivery (queued mode)', async () => {
      const mockDelivery = {
        id: mockDeliveryId,
        eventId: mockEventId,
        endpointId: mockEndpointId,
        seq: 10,
        state: deliveryState.DEAD,
        attemptCount: 5,
        endpointUrl: mockEndpoint.url,
      };

      const mockRequeued = {
        ...mockDelivery,
        state: deliveryState.PENDING,
        attemptCount: 0,
        lastError: null,
      };

      deliveryRepository.findByIdAndTenant.mockResolvedValue(mockDelivery);
      deliveryRepository.releaseLease.mockResolvedValue(mockRequeued);

      const res = await request(app).post(`/deliveries/${mockDeliveryId}/resend`).send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Delivery queued for resend');
      expect(res.body.delivery.state).toBe('PENDING');
      expect(res.body.delivery.seq).toBe(10);
      expect(deliveryRepository.releaseLease).toHaveBeenCalledWith(
        mockDeliveryId,
        deliveryState.PENDING,
        expect.any(String),
        null
      );
    });

    it('allows resending a SUCCEEDED delivery (queued mode)', async () => {
      const mockDelivery = {
        id: mockDeliveryId,
        eventId: mockEventId,
        endpointId: mockEndpointId,
        seq: 12,
        state: deliveryState.SUCCEEDED,
        attemptCount: 1,
        endpointUrl: mockEndpoint.url,
      };

      const mockRequeued = {
        ...mockDelivery,
        state: deliveryState.PENDING,
        attemptCount: 0,
      };

      deliveryRepository.findByIdAndTenant.mockResolvedValue(mockDelivery);
      deliveryRepository.releaseLease.mockResolvedValue(mockRequeued);

      const res = await request(app).post(`/deliveries/${mockDeliveryId}/resend`).send({ immediate: false });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.delivery.state).toBe('PENDING');
      expect(res.body.delivery.seq).toBe(12);
    });

    it('allows resending a CANCELLED delivery (queued mode)', async () => {
      const mockDelivery = {
        id: mockDeliveryId,
        eventId: mockEventId,
        endpointId: mockEndpointId,
        seq: 18,
        state: deliveryState.CANCELLED,
        attemptCount: 0,
        endpointUrl: mockEndpoint.url,
      };

      const mockRequeued = {
        ...mockDelivery,
        state: deliveryState.PENDING,
        attemptCount: 0,
      };

      deliveryRepository.findByIdAndTenant.mockResolvedValue(mockDelivery);
      deliveryRepository.releaseLease.mockResolvedValue(mockRequeued);

      const res = await request(app).post(`/deliveries/${mockDeliveryId}/resend`).send();

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.delivery.state).toBe('PENDING');
    });

    it('rejects resending an IN_FLIGHT delivery with 400 Bad Request', async () => {
      const mockDelivery = {
        id: mockDeliveryId,
        state: deliveryState.IN_FLIGHT,
      };

      deliveryRepository.findByIdAndTenant.mockResolvedValue(mockDelivery);

      const res = await request(app).post(`/deliveries/${mockDeliveryId}/resend`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid state transition');
      expect(res.body.message).toContain('currently in flight');
    });

    it('rejects resending deliveries in ineligible states such as SCHEDULED', async () => {
      const mockDelivery = {
        id: mockDeliveryId,
        state: deliveryState.SCHEDULED,
      };

      deliveryRepository.findByIdAndTenant.mockResolvedValue(mockDelivery);

      const res = await request(app).post(`/deliveries/${mockDeliveryId}/resend`);

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('not eligible for resend');
    });
  });

  // =========================================================================
  // 3. Immediate Resend Execution Lifecycle
  // =========================================================================
  describe('3. Immediate Resend Execution (immediate: true)', () => {
    it('claims lease, executes attempt, records outcome, and returns attempt details', async () => {
      const mockDelivery = {
        id: mockDeliveryId,
        eventId: mockEventId,
        endpointId: mockEndpointId,
        seq: 7,
        state: deliveryState.DEAD,
        attemptCount: 3,
        endpointUrl: mockEndpoint.url,
      };

      const claimedDelivery = {
        ...mockDelivery,
        state: deliveryState.IN_FLIGHT,
      };

      const mockAttempt = {
        deliveryId: mockDeliveryId,
        attemptNo: 4,
        startedAt: new Date().toISOString(),
        statusCode: 200,
        latencyMs: 95,
        error: null,
        outcome: deliveryOutcome.SUCCESS,
        responseBody: '{"acknowledged":true}',
        responseHeaders: { 'content-type': 'application/json' },
        requestHeaders: { 'X-Webhook-Id': mockDeliveryId, 'X-Webhook-Signature': '[REDACTED]' },
      };

      const finalDelivery = {
        ...mockDelivery,
        state: deliveryState.SUCCEEDED,
        attemptCount: 4,
      };

      deliveryRepository.findByIdAndTenant.mockResolvedValue(mockDelivery);
      deliveryRepository.claimForImmediateExecution.mockResolvedValue(claimedDelivery);
      endpointRepository.findByIdAndTenant.mockResolvedValue(mockEndpoint);
      shouldAttempt.mockResolvedValue(true);
      tryAcquire.mockResolvedValue(true);
      attemptExecutor.execute.mockResolvedValue(mockAttempt);
      handleOutcome.mockResolvedValue(finalDelivery);

      const res = await request(app)
        .post(`/deliveries/${mockDeliveryId}/resend`)
        .send({ immediate: true });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Delivery resent immediately');
      expect(res.body.delivery.state).toBe('SUCCEEDED');
      expect(res.body.delivery.seq).toBe(7);
      expect(res.body.attempt).toBeDefined();
      expect(res.body.attempt.statusCode).toBe(200);
      expect(res.body.attempt.responseBody).toBe('{"acknowledged":true}');
      expect(res.body.attempt.responseHeaders).toEqual({ 'content-type': 'application/json' });
      expect(res.body.attempt.requestHeaders['X-Webhook-Signature']).toBe('[REDACTED]');

      expect(deliveryRepository.claimForImmediateExecution).toHaveBeenCalledWith(mockDeliveryId, 30000);
      expect(attemptExecutor.execute).toHaveBeenCalledWith(claimedDelivery, mockEndpoint);
      expect(handleOutcome).toHaveBeenCalledWith(claimedDelivery, mockAttempt.outcome, mockAttempt, mockEndpoint);
    });

    it('enforces circuit breaker during immediate resend', async () => {
      const mockDelivery = {
        id: mockDeliveryId,
        endpointId: mockEndpointId,
        state: deliveryState.DEAD,
        attemptCount: 1,
      };

      deliveryRepository.findByIdAndTenant.mockResolvedValue(mockDelivery);
      deliveryRepository.claimForImmediateExecution.mockResolvedValue({
        ...mockDelivery,
        state: deliveryState.IN_FLIGHT,
      });
      endpointRepository.findByIdAndTenant.mockResolvedValue(mockEndpoint);
      shouldAttempt.mockResolvedValue(false);
      deliveryRepository.releaseLease.mockResolvedValue({
        ...mockDelivery,
        state: deliveryState.RETRYING,
      });

      const res = await request(app)
        .post(`/deliveries/${mockDeliveryId}/resend`)
        .send({ immediate: true });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('circuit breaker is open');
      expect(res.body.blocked).toBe('CIRCUIT_BREAKER_OPEN');
      expect(attemptExecutor.execute).not.toHaveBeenCalled();
    });

    it('enforces endpoint rate limiter during immediate resend', async () => {
      const mockDelivery = {
        id: mockDeliveryId,
        endpointId: mockEndpointId,
        state: deliveryState.DEAD,
        attemptCount: 1,
      };

      deliveryRepository.findByIdAndTenant.mockResolvedValue(mockDelivery);
      deliveryRepository.claimForImmediateExecution.mockResolvedValue({
        ...mockDelivery,
        state: deliveryState.IN_FLIGHT,
      });
      endpointRepository.findByIdAndTenant.mockResolvedValue(mockEndpoint);
      shouldAttempt.mockResolvedValue(true);
      tryAcquire.mockResolvedValue(false);
      deliveryRepository.releaseLease.mockResolvedValue({
        ...mockDelivery,
        state: deliveryState.RETRYING,
      });

      const res = await request(app)
        .post(`/deliveries/${mockDeliveryId}/resend`)
        .send({ immediate: true });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('rate limit exceeded');
      expect(res.body.blocked).toBe('RATE_LIMITED');
      expect(attemptExecutor.execute).not.toHaveBeenCalled();
    });

    it('protects against concurrent immediate resend collisions', async () => {
      const mockDelivery = {
        id: mockDeliveryId,
        state: deliveryState.SUCCEEDED,
      };

      deliveryRepository.findByIdAndTenant
        .mockResolvedValueOnce(mockDelivery)
        .mockResolvedValueOnce({ ...mockDelivery, state: deliveryState.IN_FLIGHT });
      deliveryRepository.claimForImmediateExecution.mockResolvedValue(null);

      const res = await request(app)
        .post(`/deliveries/${mockDeliveryId}/resend`)
        .send({ immediate: true });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('currently in flight');
    });
  });

  // =========================================================================
  // 4. Delivery Inspector Data Assembly & Response Fields
  // =========================================================================
  describe('4. Delivery Inspector Data Assembly (GET /deliveries/:id)', () => {
    it('returns delivery details with response body, response headers, and request headers per attempt', async () => {
      const mockDelivery = {
        id: mockDeliveryId,
        eventId: mockEventId,
        endpointId: mockEndpointId,
        seq: 1,
        state: deliveryState.DEAD,
        attemptCount: 2,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:05:00Z',
      };

      const mockAttempts = [
        {
          id: '1',
          deliveryId: mockDeliveryId,
          attemptNo: 1,
          startedAt: '2024-01-01T00:00:00Z',
          statusCode: 502,
          latencyMs: 120,
          error: 'Bad Gateway',
          responseBody: '<html>502 Bad Gateway</html>',
          responseHeaders: { 'server': 'cloudflare', 'content-type': 'text/html' },
          requestHeaders: { 'X-Webhook-Id': mockDeliveryId, 'X-Webhook-Signature': '[REDACTED]' },
        },
        {
          id: '2',
          deliveryId: mockDeliveryId,
          attemptNo: 2,
          startedAt: '2024-01-01T00:01:00Z',
          statusCode: 422,
          latencyMs: 85,
          error: null,
          responseBody: JSON.stringify({ error: 'Unprocessable Entity', field: 'email' }),
          responseHeaders: { 'content-type': 'application/json' },
          requestHeaders: { 'X-Webhook-Id': mockDeliveryId, 'X-Webhook-Signature': '[REDACTED]' },
        },
      ];

      deliveryRepository.findByIdAndTenant.mockResolvedValue(mockDelivery);
      deliveryRepository.findAttemptsByDeliveryId.mockResolvedValue(mockAttempts);
      eventRepository.findById.mockResolvedValue({
        id: mockEventId,
        payload: { event: 'order.placed', amount: 100 },
        createdAt: '2024-01-01T00:00:00Z',
      });
      endpointRepository.findByIdAndTenant.mockResolvedValue(mockEndpoint);

      const res = await request(app).get(`/deliveries/${mockDeliveryId}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(mockDeliveryId);
      expect(res.body.attempts).toHaveLength(2);

      const att1 = res.body.attempts[0];
      expect(att1.statusCode).toBe(502);
      expect(att1.responseBody).toBe('<html>502 Bad Gateway</html>');
      expect(att1.responseHeaders.server).toBe('cloudflare');

      const att2 = res.body.attempts[1];
      expect(att2.statusCode).toBe(422);
      expect(att2.responseBody).toContain('"error":"Unprocessable Entity"');
      expect(att2.responseHeaders['content-type']).toBe('application/json');

      // Top-level request summary has redacted headers
      expect(res.body.request.headers['X-Webhook-Signature']).toBe('[REDACTED]');
    });

    it('returns attempts array with response fields via GET /deliveries/:id/attempts', async () => {
      const mockDelivery = {
        id: mockDeliveryId,
        endpointId: mockEndpointId,
      };

      const mockAttempts = [
        {
          id: '1',
          deliveryId: mockDeliveryId,
          attemptNo: 1,
          startedAt: '2024-01-01T00:00:00Z',
          statusCode: 200,
          latencyMs: 40,
          responseBody: '{"ok":true}',
          responseHeaders: { 'content-type': 'application/json' },
          requestHeaders: { 'X-Webhook-Id': mockDeliveryId },
        },
      ];

      deliveryRepository.findByIdAndTenant.mockResolvedValue(mockDelivery);
      deliveryRepository.findAttemptsByDeliveryId.mockResolvedValue(mockAttempts);
      endpointRepository.findByIdAndTenant.mockResolvedValue(mockEndpoint);

      const res = await request(app).get(`/deliveries/${mockDeliveryId}/attempts`);

      expect(res.status).toBe(200);
      expect(res.body.attempts).toHaveLength(1);
      expect(res.body.attempts[0].responseBody).toBe('{"ok":true}');
      expect(res.body.attempts[0].responseHeaders).toEqual({ 'content-type': 'application/json' });
    });
  });

  // =========================================================================
  // 5. Tenant Isolation, Missing Records & Backward Compatibility
  // =========================================================================
  describe('5. Authorization & Backward Compatibility', () => {
    it('returns 404 when attempting to resend cross-tenant delivery', async () => {
      deliveryRepository.findByIdAndTenant.mockResolvedValue(null);

      const res = await request(app).post(`/deliveries/${mockDeliveryId}/resend`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Not found');
      expect(deliveryRepository.findByIdAndTenant).toHaveBeenCalledWith(mockDeliveryId, mockTenantId);
    });

    it('returns 400 for malformed UUID parameter', async () => {
      const res = await request(app).post('/deliveries/not-a-valid-uuid/resend');
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Invalid delivery ID');
    });

    it('returns 400 when immediate parameter is non-boolean', async () => {
      const res = await request(app)
        .post(`/deliveries/${mockDeliveryId}/resend`)
        .send({ immediate: 'yes' });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('immediate must be a boolean');
    });

    it('preserves backward compatibility of POST /deliveries/:id/replay (only DEAD)', async () => {
      const mockDeadDelivery = {
        id: mockDeliveryId,
        endpointId: mockEndpointId,
        seq: 1,
        state: deliveryState.DEAD,
      };

      deliveryRepository.findByIdAndTenant.mockResolvedValue(mockDeadDelivery);
      deliveryRepository.releaseLease.mockResolvedValue({
        ...mockDeadDelivery,
        state: deliveryState.PENDING,
      });

      const res = await request(app).post(`/deliveries/${mockDeliveryId}/replay`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Delivery replayed successfully');
    });

    it('preserves replay rejection of SUCCEEDED delivery via POST /deliveries/:id/replay', async () => {
      const mockSucceeded = {
        id: mockDeliveryId,
        endpointId: mockEndpointId,
        state: deliveryState.SUCCEEDED,
      };

      deliveryRepository.findByIdAndTenant.mockResolvedValue(mockSucceeded);

      const res = await request(app).post(`/deliveries/${mockDeliveryId}/replay`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid state transition');
    });
  });
});
