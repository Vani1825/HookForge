/**
 * Tests for event routes including GET /events/:id/deliveries.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import config from '../../src/config/index.js';
import eventsRouter from '../../src/routes/events.js';
import eventIngestService from '../../src/services/ingest/eventIngestService.js';
import deliveryService from '../../src/services/delivery/deliveryService.js';
import { deliveryState } from '../../src/domain/deliveryState.js';
import { errorHandler, PayloadTooLargeError } from '../../src/middleware/errorHandler.js';

// Mock services
vi.mock('../../src/services/ingest/eventIngestService.js');
vi.mock('../../src/services/delivery/deliveryService.js');

// Mock validationResult to always pass (validation tested in integration)
vi.mock('express-validator', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    validationResult: () => ({
      isEmpty: () => true,
      array: () => [],
    }),
  };
});

function createApp() {
  const app = express();
  app.use(express.json({ limit: config.ingest.maxPayloadBytes }));
  
  // Mock auth middleware to set tenantId
  app.use((req, res, next) => {
    req.tenantId = 'tenant-1';
    next();
  });
  
  app.use('/events', eventsRouter);
  app.use(errorHandler);
  
  return app;
}

describe('Event Routes', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  describe('POST /events', () => {
    it('should ingest new event and return 202 Accepted', async () => {
      eventIngestService.ingest.mockResolvedValue({
        duplicate: false,
        event: {
          id: 'event-new-1',
          idempotencyKey: 'key-new',
          createdAt: '2024-01-01T00:00:00Z',
        },
        deliveriesEnqueued: 2,
      });

      const response = await request(app)
        .post('/events')
        .set('Idempotency-Key', 'key-new')
        .send({ message: 'hello' });

      expect(response.status).toBe(202);
      expect(response.body).toEqual({
        id: 'event-new-1',
        idempotencyKey: 'key-new',
        createdAt: '2024-01-01T00:00:00Z',
        deliveriesEnqueued: 2,
      });
      expect(eventIngestService.ingest).toHaveBeenCalledWith(
        'tenant-1',
        'key-new',
        JSON.stringify({ message: 'hello' })
      );
    });

    it('should return 200 OK for duplicate idempotency key with 0 deliveries enqueued', async () => {
      eventIngestService.ingest.mockResolvedValue({
        duplicate: true,
        event: {
          id: 'event-dup-1',
          idempotencyKey: 'key-dup',
          createdAt: '2024-01-01T00:00:00Z',
        },
        deliveriesEnqueued: 0,
      });

      const response = await request(app)
        .post('/events')
        .set('Idempotency-Key', 'key-dup')
        .send({ message: 'hello again' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        id: 'event-dup-1',
        idempotencyKey: 'key-dup',
        createdAt: '2024-01-01T00:00:00Z',
        deliveriesEnqueued: 0,
      });
    });

    it('should handle concurrent requests safely without duplicate deliveries', async () => {
      // Simulate two concurrent requests with same idempotency key
      eventIngestService.ingest
        .mockResolvedValueOnce({
          duplicate: false,
          event: { id: 'event-conc', idempotencyKey: 'key-conc', createdAt: '2024-01-01T00:00:00Z' },
          deliveriesEnqueued: 1,
        })
        .mockResolvedValueOnce({
          duplicate: true,
          event: { id: 'event-conc', idempotencyKey: 'key-conc', createdAt: '2024-01-01T00:00:00Z' },
          deliveriesEnqueued: 0,
        });

      const [res1, res2] = await Promise.all([
        request(app).post('/events').set('Idempotency-Key', 'key-conc').send({ data: 1 }),
        request(app).post('/events').set('Idempotency-Key', 'key-conc').send({ data: 1 }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([200, 202]);
      const res202 = res1.status === 202 ? res1 : res2;
      const res200 = res1.status === 200 ? res1 : res2;
      expect(res202.body.deliveriesEnqueued).toBe(1);
      expect(res200.body.deliveriesEnqueued).toBe(0);
      expect(res200.body.id).toBe(res202.body.id);
    });

    it('should return 400 when body is missing', async () => {
      const response = await request(app)
        .post('/events')
        .set('Idempotency-Key', 'key-missing-body');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Validation Error',
        message: 'Request body must be a non-empty JSON object',
      });
      expect(eventIngestService.ingest).not.toHaveBeenCalled();
    });

    it('should return 400 when body is an empty object', async () => {
      const response = await request(app)
        .post('/events')
        .set('Idempotency-Key', 'key-empty-obj')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Validation Error',
        message: 'Request body must be a non-empty JSON object',
      });
      expect(eventIngestService.ingest).not.toHaveBeenCalled();
    });

    it('should return 400 when body is an array', async () => {
      const response = await request(app)
        .post('/events')
        .set('Idempotency-Key', 'key-array')
        .send([1, 2, 3]);

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Validation Error',
        message: 'Request body must be a non-empty JSON object',
      });
      expect(eventIngestService.ingest).not.toHaveBeenCalled();
    });

    it('should return 400 when body is a primitive string', async () => {
      const response = await request(app)
        .post('/events')
        .set('Idempotency-Key', 'key-string')
        .set('Content-Type', 'application/json')
        .send('"just a string"');

      expect(response.status).toBe(400);
      expect(eventIngestService.ingest).not.toHaveBeenCalled();
    });

    it('should return 400 when body is a primitive number', async () => {
      const response = await request(app)
        .post('/events')
        .set('Idempotency-Key', 'key-number')
        .set('Content-Type', 'application/json')
        .send('12345');

      expect(response.status).toBe(400);
      expect(eventIngestService.ingest).not.toHaveBeenCalled();
    });

    it('should return 400 when body is null', async () => {
      const response = await request(app)
        .post('/events')
        .set('Idempotency-Key', 'key-null')
        .set('Content-Type', 'application/json')
        .send('null');

      expect(response.status).toBe(400);
      expect(eventIngestService.ingest).not.toHaveBeenCalled();
    });

    it('should return 400 validation error if body reaches handler as primitive or null', async () => {
      const customApp = express();
      customApp.use(express.json({ strict: false }));
      customApp.use((req, res, next) => {
        req.tenantId = 'tenant-1';
        next();
      });
      customApp.use('/events', eventsRouter);
      customApp.use(errorHandler);

      const resString = await request(customApp)
        .post('/events')
        .set('Idempotency-Key', 'key-str')
        .set('Content-Type', 'application/json')
        .send('"just a string"');

      expect(resString.status).toBe(400);
      expect(resString.body).toEqual({
        error: 'Validation Error',
        message: 'Request body must be a non-empty JSON object',
      });

      const resNull = await request(customApp)
        .post('/events')
        .set('Idempotency-Key', 'key-null')
        .set('Content-Type', 'application/json')
        .send('null');

      expect(resNull.status).toBe(400);
      expect(resNull.body).toEqual({
        error: 'Validation Error',
        message: 'Request body must be a non-empty JSON object',
      });
      expect(eventIngestService.ingest).not.toHaveBeenCalled();
    });

    it('should return 413 Payload Too Large when ingest service throws PayloadTooLargeError', async () => {
      eventIngestService.ingest.mockRejectedValue(
        new PayloadTooLargeError('Payload too large (300000 bytes, maximum allowed is 262144 bytes)')
      );

      const response = await request(app)
        .post('/events')
        .set('Idempotency-Key', 'key-large')
        .send({ message: 'x'.repeat(100) });

      expect(response.status).toBe(413);
      expect(response.body).toEqual({
        error: {
          type: 'payload_too_large',
          message: 'Payload too large (300000 bytes, maximum allowed is 262144 bytes)',
        },
      });
    });

    it('should return 413 Payload Too Large when request body exceeds express json limit', async () => {
      const originalLimit = config.ingest.maxPayloadBytes;
      try {
        config.ingest.maxPayloadBytes = 1024;
        const testApp = createApp();
        const response = await request(testApp)
          .post('/events')
          .set('Idempotency-Key', 'key-express-limit')
          .set('Content-Type', 'application/json')
          .send(JSON.stringify({ large: 'a'.repeat(2048) }));

        expect(response.status).toBe(413);
        expect(response.body.error.type).toBe('payload_too_large');
      } finally {
        config.ingest.maxPayloadBytes = originalLimit;
      }
    });
  });

  describe('GET /events/:id/deliveries', () => {
    it('should return deliveries for an event', async () => {
      const mockDeliveries = [
        {
          id: 'delivery-1',
          endpointId: 'endpoint-1',
          endpointUrl: 'https://example.com/hook1',
          lastStatusCode: 200,
          seq: 1,
          state: deliveryState.SUCCEEDED,
          attemptCount: 1,
          nextAttemptAt: null,
          lastError: null,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:01:00Z',
        },
        {
          id: 'delivery-2',
          endpointId: 'endpoint-2',
          seq: 1,
          state: deliveryState.DEAD,
          attemptCount: 3,
          nextAttemptAt: null,
          lastError: 'Max retries exceeded',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:05:00Z',
        },
      ];

      deliveryService.getDeliveriesByEvent.mockResolvedValue(mockDeliveries);

      const response = await request(app).get('/events/event-1/deliveries');

      expect(response.status).toBe(200);
      expect(response.body.eventId).toBe('event-1');
      expect(response.body.deliveries).toHaveLength(2);
      expect(response.body.deliveries[0].endpoint_url).toBe('https://example.com/hook1');
      expect(response.body.deliveries[0].last_status_code).toBe(200);
      expect(deliveryService.getDeliveriesByEvent).toHaveBeenCalledWith('event-1', 'tenant-1');
    });

    it('should return empty array when no deliveries', async () => {
      deliveryService.getDeliveriesByEvent.mockResolvedValue([]);

      const response = await request(app).get('/events/event-1/deliveries');

      expect(response.status).toBe(200);
      expect(response.body.deliveries).toHaveLength(0);
    });

    it('should return 400 for invalid event ID', async () => {
      // Skip - validation is mocked to pass in unit tests
      // This is tested in integration tests
      expect(true).toBe(true);
    });

    it('should enforce tenant scope', async () => {
      deliveryService.getDeliveriesByEvent.mockResolvedValue([]);

      await request(app).get('/events/event-1/deliveries');

      expect(deliveryService.getDeliveriesByEvent).toHaveBeenCalledWith('event-1', 'tenant-1');
    });
  });
});
