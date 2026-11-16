/**
 * Tests for event routes including GET /events, GET /events/:id, and GET /events/:id/deliveries.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import config from '../../src/config/index.js';
import eventsRouter from '../../src/routes/events.js';
import eventRepository from '../../src/repositories/jdbc/eventRepository.js';
import deliveryService from '../../src/services/delivery/deliveryService.js';
import { deliveryState } from '../../src/domain/deliveryState.js';
import { errorHandler, PayloadTooLargeError } from '../../src/middleware/errorHandler.js';

// Mock services and repositories
vi.mock('../../src/services/ingest/eventIngestService.js');
vi.mock('../../src/services/delivery/deliveryService.js');
vi.mock('../../src/repositories/jdbc/eventRepository.js', () => ({
  default: {
    findWithFilters: vi.fn(),
    findAllByTenant: vi.fn(),
    findById: vi.fn(),
    insert: vi.fn(),
    findByTenantAndIdempotencyKey: vi.fn(),
    enqueue: vi.fn(),
  },
}));

vi.mock('../../src/middleware/auth.js', () => ({
  apiKeyAuth: (req, res, next) => {
    req.tenantId = '123e4567-e89b-12d3-a456-426614174000';
    next();
  },
  TENANT_ID_ATTRIBUTE: 'tenantId',
}));

function createApp() {
  const app = express();
<<<<<<< HEAD
  app.use(express.json({ limit: config.ingest.maxPayloadBytes }));
  
  // Mock auth middleware to set tenantId
=======
  app.use(express.json());

>>>>>>> a86c7832e5318df24b920b36e7ca39eb2b80ae92
  app.use((req, res, next) => {
    req.tenantId = '123e4567-e89b-12d3-a456-426614174000';
    next();
  });

  app.use('/events', eventsRouter);
<<<<<<< HEAD
  app.use(errorHandler);
  
=======

>>>>>>> a86c7832e5318df24b920b36e7ca39eb2b80ae92
  return app;
}

describe('Event Routes', () => {
  let app;
  const mockTenantId = '123e4567-e89b-12d3-a456-426614174000';
  const mockEventId = '111e6543-e89b-12d3-a456-426614174111';

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

<<<<<<< HEAD
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
=======
  describe('GET /events', () => {
    const mockEvents = [
      {
        id: mockEventId,
        tenantId: mockTenantId,
        payloadJson: JSON.stringify({ action: 'order.created', amount: 99.99 }),
        idempotencyKey: 'idemp-key-1',
        createdAt: '2024-01-01T00:00:00Z',
      },
    ];

    it('should return events with default pagination', async () => {
      eventRepository.findWithFilters.mockResolvedValue({
        events: mockEvents,
        totalRecords: 1,
      });

      const response = await request(app).get('/events');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.events).toHaveLength(1);
      expect(response.body.data[0].id).toBe(mockEventId);
      expect(response.body.data[0].payload).toEqual({ action: 'order.created', amount: 99.99 });
      expect(response.body.pagination).toEqual({
        page: 1,
        pageSize: 20,
        totalRecords: 1,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      });
      expect(eventRepository.findWithFilters).toHaveBeenCalledWith(
        mockTenantId,
        expect.anything(),
        { page: 1, pageSize: 20 }
      );
    });

    it('should support page and pageSize parameters', async () => {
      eventRepository.findWithFilters.mockResolvedValue({
        events: mockEvents,
        totalRecords: 25,
      });

      const response = await request(app).get('/events?page=2&pageSize=10');

      expect(response.status).toBe(200);
      expect(response.body.pagination).toEqual({
        page: 2,
        pageSize: 10,
        totalRecords: 25,
        totalPages: 3,
        hasNext: true,
        hasPrev: true,
      });
      expect(eventRepository.findWithFilters).toHaveBeenCalledWith(
        mockTenantId,
        expect.anything(),
        { page: 2, pageSize: 10 }
      );
    });

    it('should support legacy limit and offset parameters', async () => {
      eventRepository.findWithFilters.mockResolvedValue({
        events: [],
        totalRecords: 100,
      });

      const response = await request(app).get('/events?limit=25&offset=50');

      expect(response.status).toBe(200);
      expect(eventRepository.findWithFilters).toHaveBeenCalledWith(
        mockTenantId,
        expect.anything(),
        { page: 3, pageSize: 25, limit: 25, offset: 50 }
      );
      expect(response.body.pagination.offset).toBe(50);
    });

    it('should support arbitrary offset preserving exact skip semantics', async () => {
      eventRepository.findWithFilters.mockResolvedValue({
        events: mockEvents,
        totalRecords: 50,
      });

      const response = await request(app).get('/events?limit=20&offset=5');

      expect(response.status).toBe(200);
      expect(eventRepository.findWithFilters).toHaveBeenCalledWith(
        mockTenantId,
        expect.anything(),
        { page: 1, pageSize: 20, limit: 20, offset: 5 }
      );
      expect(response.body.pagination.offset).toBe(5);
    });

    it('should support legacy limit up to 1000 without clamping', async () => {
      eventRepository.findWithFilters.mockResolvedValue({
        events: mockEvents,
        totalRecords: 500,
      });

      const response = await request(app).get('/events?limit=500');

      expect(response.status).toBe(200);
      expect(eventRepository.findWithFilters).toHaveBeenCalledWith(
        mockTenantId,
        expect.anything(),
        { page: 1, pageSize: 500, limit: 500 }
      );
      expect(response.body.pagination.pageSize).toBe(500);
    });

    it('should enforce parameter precedence: pageSize over limit, page over offset', async () => {
      eventRepository.findWithFilters.mockResolvedValue({
        events: mockEvents,
        totalRecords: 50,
      });

      const response = await request(app).get('/events?pageSize=10&limit=500&page=2&offset=5');

      expect(response.status).toBe(200);
      expect(eventRepository.findWithFilters).toHaveBeenCalledWith(
        mockTenantId,
        expect.anything(),
        { page: 2, pageSize: 10 }
      );
      expect(response.body.pagination.pageSize).toBe(10);
      expect(response.body.pagination.page).toBe(2);
      expect(response.body.pagination.offset).toBeUndefined();
    });

    it('should support filtering by idempotency_key, dates, and q', async () => {
      eventRepository.findWithFilters.mockResolvedValue({
        events: mockEvents,
        totalRecords: 1,
      });

      const response = await request(app).get(
        '/events?idempotency_key=idemp-1&created_after=2024-01-01T00:00:00Z&created_before=2024-01-02T00:00:00Z&q=order'
      );

      expect(response.status).toBe(200);
      expect(eventRepository.findWithFilters).toHaveBeenCalledWith(
        mockTenantId,
        expect.objectContaining({
          idempotency_key: 'idemp-1',
          created_after: '2024-01-01T00:00:00Z',
          created_before: '2024-01-02T00:00:00Z',
          q: 'order',
        }),
        expect.anything()
      );
    });

    it('should return 400 for invalid page (< 1)', async () => {
      const response = await request(app).get('/events?page=0');
      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid pageSize (> 100)', async () => {
      const response = await request(app).get('/events?pageSize=101');
      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid created_after date', async () => {
      const response = await request(app).get('/events?created_after=bad-date');
      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid created_before date', async () => {
      const response = await request(app).get('/events?created_before=bad-date');
      expect(response.status).toBe(400);
    });

    it('should return 400 when created_after is later than created_before', async () => {
      const response = await request(app).get(
        '/events?created_after=2024-01-02T00:00:00Z&created_before=2024-01-01T00:00:00Z'
      );
      expect(response.status).toBe(400);
      expect(response.body.message).toContain('created_after cannot be later than created_before');
    });

    it('should accept equal created_after and created_before timestamps', async () => {
      eventRepository.findWithFilters.mockResolvedValue({
        events: mockEvents,
        totalRecords: 1,
      });

      const response = await request(app).get(
        '/events?created_after=2024-01-01T00:00:00Z&created_before=2024-01-01T00:00:00Z'
      );
      expect(response.status).toBe(200);
    });

    it('should accept valid date range when created_after is earlier than created_before', async () => {
      eventRepository.findWithFilters.mockResolvedValue({
        events: mockEvents,
        totalRecords: 1,
      });

      const response = await request(app).get(
        '/events?created_after=2024-01-01T00:00:00Z&created_before=2024-01-02T00:00:00Z'
      );
      expect(response.status).toBe(200);
    });
  });

  describe('GET /events/:id', () => {
    it('should return event by ID when found', async () => {
      const mockEvent = {
        id: mockEventId,
        tenantId: mockTenantId,
        payloadJson: JSON.stringify({ test: true }),
        idempotencyKey: 'idemp-single',
        createdAt: '2024-01-01T00:00:00Z',
      };
      eventRepository.findById.mockResolvedValue(mockEvent);

      const response = await request(app).get(`/events/${mockEventId}`);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(mockEventId);
      expect(response.body.payload).toEqual({ test: true });
    });

    it('should return 404 when event not found or cross-tenant', async () => {
      eventRepository.findById.mockResolvedValue(null);

      const response = await request(app).get(`/events/${mockEventId}`);

      expect(response.status).toBe(404);
    });

    it('should return 400 for invalid event UUID', async () => {
      const response = await request(app).get('/events/not-a-uuid');

      expect(response.status).toBe(400);
>>>>>>> a86c7832e5318df24b920b36e7ca39eb2b80ae92
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

      const response = await request(app).get(`/events/${mockEventId}/deliveries`);

      expect(response.status).toBe(200);
      expect(response.body.eventId).toBe(mockEventId);
      expect(response.body.deliveries).toHaveLength(2);
<<<<<<< HEAD
      expect(response.body.deliveries[0].endpoint_url).toBe('https://example.com/hook1');
      expect(response.body.deliveries[0].last_status_code).toBe(200);
      expect(deliveryService.getDeliveriesByEvent).toHaveBeenCalledWith('event-1', 'tenant-1');
=======
      expect(deliveryService.getDeliveriesByEvent).toHaveBeenCalledWith(mockEventId, mockTenantId);
>>>>>>> a86c7832e5318df24b920b36e7ca39eb2b80ae92
    });

    it('should return empty array when no deliveries', async () => {
      deliveryService.getDeliveriesByEvent.mockResolvedValue([]);

      const response = await request(app).get(`/events/${mockEventId}/deliveries`);

      expect(response.status).toBe(200);
      expect(response.body.deliveries).toHaveLength(0);
    });

    it('should return 400 for invalid event ID', async () => {
      const response = await request(app).get('/events/not-a-uuid/deliveries');

      expect(response.status).toBe(400);
    });

    it('should enforce tenant scope', async () => {
      deliveryService.getDeliveriesByEvent.mockResolvedValue([]);

      await request(app).get(`/events/${mockEventId}/deliveries`);

      expect(deliveryService.getDeliveriesByEvent).toHaveBeenCalledWith(mockEventId, mockTenantId);
    });
  });
});
