/**
 * Integration tests for Scheduling & Bulk Replay routes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import deliveriesRouter from '../../src/routes/deliveries.js';
import deliveryService from '../../src/services/delivery/deliveryService.js';
import { deliveryState } from '../../src/domain/deliveryState.js';
import { IllegalStateTransitionError } from '../../src/domain/errors/illegalStateTransitionError.js';

vi.mock('../../src/services/delivery/deliveryService.js', () => ({
  default: {
    queryDeliveries: vi.fn(),
    getDeliveriesByState: vi.fn(),
    getAllDeliveries: vi.fn(),
    getDeliveryById: vi.fn(),
    replayDelivery: vi.fn(),
    scheduleDelivery: vi.fn(),
    getScheduledDeliveries: vi.fn(),
    getScheduledDeliveryById: vi.fn(),
    cancelScheduledDelivery: vi.fn(),
    bulkReplayDeliveries: vi.fn(),
  },
}));

function createApp(withAuth = true) {
  const app = express();
  app.use(express.json());

  if (withAuth) {
    app.use((req, res, next) => {
      req.tenantId = '123e4567-e89b-12d3-a456-426614174000';
      next();
    });
  }

  app.use('/deliveries', deliveriesRouter);

  return app;
}

describe('Scheduling & Bulk Replay Routes', () => {
  let app;
  const mockTenantId = '123e4567-e89b-12d3-a456-426614174000';
  const mockDeliveryId = '987e6543-e89b-12d3-a456-426614174999';
  const mockEndpointId = '111e6543-e89b-12d3-a456-426614174111';
  const mockEventId = '222e6543-e89b-12d3-a456-426614174222';
  const futureDate = new Date(Date.now() + 86400000).toISOString();

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  describe('POST /deliveries/schedule', () => {
    it('should successfully schedule a webhook delivery with payload', async () => {
      const mockCreated = {
        id: mockDeliveryId,
        eventId: mockEventId,
        endpointId: mockEndpointId,
        endpointUrl: 'https://example.com/webhook',
        seq: 1,
        state: deliveryState.SCHEDULED,
        attemptCount: 0,
        scheduledAt: futureDate,
        nextAttemptAt: futureDate,
        createdAt: '2026-11-20T12:00:00Z',
        updatedAt: '2026-11-20T12:00:00Z',
      };

      deliveryService.scheduleDelivery.mockResolvedValue(mockCreated);

      const response = await request(app)
        .post('/deliveries/schedule')
        .send({
          endpointId: mockEndpointId,
          scheduledAt: futureDate,
          payload: { user: 'alice', action: 'signup' },
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.state).toBe('SCHEDULED');
      expect(response.body.id).toBe(mockDeliveryId);
      expect(response.body.scheduled_at).toBe(futureDate);
      expect(response.body.endpoint_url).toBe('https://example.com/webhook');
      expect(deliveryService.scheduleDelivery).toHaveBeenCalledWith(
        mockTenantId,
        expect.objectContaining({
          endpointId: mockEndpointId,
          scheduledAt: futureDate,
        })
      );
    });

    it('should successfully schedule with eventId reference', async () => {
      const mockCreated = {
        id: mockDeliveryId,
        eventId: mockEventId,
        endpointId: mockEndpointId,
        seq: 2,
        state: deliveryState.SCHEDULED,
        attemptCount: 0,
        scheduledAt: futureDate,
        nextAttemptAt: futureDate,
        createdAt: '2026-11-20T12:00:00Z',
        updatedAt: '2026-11-20T12:00:00Z',
      };

      deliveryService.scheduleDelivery.mockResolvedValue(mockCreated);

      const response = await request(app)
        .post('/deliveries/schedule')
        .send({
          endpoint_id: mockEndpointId,
          scheduled_at: futureDate,
          event_id: mockEventId,
        });

      expect(response.status).toBe(201);
      expect(response.body.id).toBe(mockDeliveryId);
      expect(response.body.state).toBe('SCHEDULED');
    });

    it('should reject scheduling with past timestamp (400)', async () => {
      const pastDate = new Date(Date.now() - 3600000).toISOString();

      const response = await request(app)
        .post('/deliveries/schedule')
        .send({
          endpointId: mockEndpointId,
          scheduledAt: pastDate,
          payload: { test: true },
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation Error');
      expect(response.body.message).toContain('future date and time');
    });

    it('should reject scheduling with invalid timestamp format (400)', async () => {
      const response = await request(app)
        .post('/deliveries/schedule')
        .send({
          endpointId: mockEndpointId,
          scheduledAt: 'not-a-valid-date',
          payload: { test: true },
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation Error');
    });

    it('should reject scheduling with missing endpoint ID (400)', async () => {
      const response = await request(app)
        .post('/deliveries/schedule')
        .send({
          scheduledAt: futureDate,
          payload: { test: true },
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation Error');
    });

    it('should reject scheduling with invalid endpoint UUID (400)', async () => {
      const response = await request(app)
        .post('/deliveries/schedule')
        .send({
          endpointId: 'invalid-uuid-123',
          scheduledAt: futureDate,
          payload: { test: true },
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation Error');
    });

    it('should reject scheduling when neither payload nor eventId is provided (400)', async () => {
      const response = await request(app)
        .post('/deliveries/schedule')
        .send({
          endpointId: mockEndpointId,
          scheduledAt: futureDate,
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation Error');
    });

    it('should return 404 when target endpoint is not found for tenant', async () => {
      const notFoundError = new Error('Endpoint not found');
      notFoundError.statusCode = 404;
      deliveryService.scheduleDelivery.mockRejectedValue(notFoundError);

      const response = await request(app)
        .post('/deliveries/schedule')
        .send({
          endpointId: mockEndpointId,
          scheduledAt: futureDate,
          payload: { test: true },
        });

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('Endpoint not found');
    });
  });

  describe('GET /deliveries/scheduled', () => {
    it('should list scheduled deliveries with pagination metadata', async () => {
      const mockScheduledList = [
        {
          id: mockDeliveryId,
          eventId: mockEventId,
          endpointId: mockEndpointId,
          endpointUrl: 'https://example.com/webhook',
          seq: 1,
          state: deliveryState.SCHEDULED,
          attemptCount: 0,
          scheduledAt: futureDate,
          nextAttemptAt: futureDate,
          createdAt: '2026-11-20T12:00:00Z',
          updatedAt: '2026-11-20T12:00:00Z',
        },
      ];

      deliveryService.getScheduledDeliveries.mockResolvedValue({
        deliveries: mockScheduledList,
        pagination: {
          page: 1,
          pageSize: 20,
          totalRecords: 1,
          totalPages: 1,
          hasNext: false,
          hasPrev: false,
        },
      });

      const response = await request(app).get('/deliveries/scheduled');

      expect(response.status).toBe(200);
      expect(response.body.state).toBe('SCHEDULED');
      expect(response.body.deliveries).toHaveLength(1);
      expect(response.body.deliveries[0].id).toBe(mockDeliveryId);
      expect(response.body.deliveries[0].scheduled_at).toBe(futureDate);
      expect(response.body.pagination.totalRecords).toBe(1);
    });
  });

  describe('GET /deliveries/scheduled/:id', () => {
    it('should retrieve a scheduled delivery by ID', async () => {
      const mockDelivery = {
        id: mockDeliveryId,
        eventId: mockEventId,
        endpointId: mockEndpointId,
        seq: 1,
        state: deliveryState.SCHEDULED,
        attemptCount: 0,
        scheduledAt: futureDate,
        nextAttemptAt: futureDate,
        createdAt: '2026-11-20T12:00:00Z',
        updatedAt: '2026-11-20T12:00:00Z',
        attempts: [],
      };

      deliveryService.getScheduledDeliveryById.mockResolvedValue(mockDelivery);

      const response = await request(app).get(`/deliveries/scheduled/${mockDeliveryId}`);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(mockDeliveryId);
      expect(response.body.state).toBe('SCHEDULED');
      expect(response.body.scheduled_at).toBe(futureDate);
    });

    it('should return 404 when scheduled delivery is not found', async () => {
      deliveryService.getScheduledDeliveryById.mockResolvedValue(null);

      const response = await request(app).get(`/deliveries/scheduled/${mockDeliveryId}`);

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('Delivery not found');
    });

    it('should return 400 for invalid UUID in path', async () => {
      const response = await request(app).get('/deliveries/scheduled/not-a-uuid');
      expect(response.status).toBe(400);
    });
  });

  describe('POST /deliveries/:id/cancel and DELETE /deliveries/scheduled/:id', () => {
    it('should successfully cancel a scheduled delivery via POST /deliveries/:id/cancel', async () => {
      const mockCancelled = {
        id: mockDeliveryId,
        eventId: mockEventId,
        endpointId: mockEndpointId,
        state: deliveryState.CANCELLED,
        attemptCount: 0,
        scheduledAt: futureDate,
        nextAttemptAt: futureDate,
        createdAt: '2026-11-20T12:00:00Z',
        updatedAt: '2026-11-20T12:05:00Z',
      };

      deliveryService.cancelScheduledDelivery.mockResolvedValue(mockCancelled);

      const response = await request(app).post(`/deliveries/${mockDeliveryId}/cancel`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.state).toBe('CANCELLED');
      expect(deliveryService.cancelScheduledDelivery).toHaveBeenCalledWith(mockDeliveryId, mockTenantId);
    });

    it('should successfully cancel via DELETE /deliveries/scheduled/:id', async () => {
      const mockCancelled = {
        id: mockDeliveryId,
        eventId: mockEventId,
        endpointId: mockEndpointId,
        state: deliveryState.CANCELLED,
        attemptCount: 0,
        createdAt: '2026-11-20T12:00:00Z',
        updatedAt: '2026-11-20T12:05:00Z',
      };

      deliveryService.cancelScheduledDelivery.mockResolvedValue(mockCancelled);

      const response = await request(app).delete(`/deliveries/scheduled/${mockDeliveryId}`);

      expect(response.status).toBe(200);
      expect(response.body.state).toBe('CANCELLED');
    });

    it('should return 404 when delivery to cancel is not found', async () => {
      const error = new Error('Delivery not found');
      error.statusCode = 404;
      deliveryService.cancelScheduledDelivery.mockRejectedValue(error);

      const response = await request(app).post(`/deliveries/${mockDeliveryId}/cancel`);

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('Delivery not found');
    });

    it('should return 400 when attempting to cancel an ineligible state', async () => {
      deliveryService.cancelScheduledDelivery.mockRejectedValue(
        new IllegalStateTransitionError('SUCCEEDED', 'CANCELLED')
      );

      const response = await request(app).post(`/deliveries/${mockDeliveryId}/cancel`);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid state transition');
    });
  });

  describe('POST /deliveries/bulk-replay', () => {
    it('should successfully process bulk replay with successful, ineligible, and rejected deliveries', async () => {
      const id1 = '11111111-1111-1111-1111-111111111111';
      const id2 = '22222222-2222-2222-2222-222222222222';
      const id3 = '33333333-3333-3333-3333-333333333333';

      const mockResult = {
        total: 3,
        successful: [
          {
            id: id1,
            deliveryId: id1,
            state: 'PENDING',
            endpointId: mockEndpointId,
          },
        ],
        replayed: [
          {
            id: id1,
            deliveryId: id1,
            state: 'PENDING',
            endpointId: mockEndpointId,
          },
        ],
        ineligible: [
          {
            id: id2,
            deliveryId: id2,
            state: 'SUCCEEDED',
            reason: 'Delivery is in state SUCCEEDED; only DEAD deliveries are eligible for replay',
          },
        ],
        rejected: [
          {
            id: id3,
            deliveryId: id3,
            reason: 'Delivery not found or access denied',
          },
        ],
        summary: {
          total: 3,
          successfulCount: 1,
          replayedCount: 1,
          ineligibleCount: 1,
          rejectedCount: 1,
        },
      };

      deliveryService.bulkReplayDeliveries.mockResolvedValue(mockResult);

      const response = await request(app)
        .post('/deliveries/bulk-replay')
        .send({
          deliveryIds: [id1, id2, id3],
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.total).toBe(3);
      expect(response.body.successful).toHaveLength(1);
      expect(response.body.ineligible).toHaveLength(1);
      expect(response.body.rejected).toHaveLength(1);
      expect(response.body.summary.successfulCount).toBe(1);
      expect(response.body.summary.ineligibleCount).toBe(1);
      expect(response.body.summary.rejectedCount).toBe(1);
      expect(deliveryService.bulkReplayDeliveries).toHaveBeenCalledWith(
        [id1, id2, id3],
        mockTenantId
      );
    });

    it('should reject bulk replay with empty deliveryIds array (400)', async () => {
      const response = await request(app)
        .post('/deliveries/bulk-replay')
        .send({
          deliveryIds: [],
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation Error');
      expect(response.body.message).toContain('deliveryIds must not be empty');
    });

    it('should reject bulk replay with non-array deliveryIds (400)', async () => {
      const response = await request(app)
        .post('/deliveries/bulk-replay')
        .send({
          deliveryIds: 'not-an-array',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation Error');
    });

    it('should reject bulk replay with invalid UUIDs in array (400)', async () => {
      const response = await request(app)
        .post('/deliveries/bulk-replay')
        .send({
          deliveryIds: ['invalid-uuid-format'],
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation Error');
      expect(response.body.message).toContain('Invalid delivery ID in array');
    });

    it('should support snake_case delivery_ids payload', async () => {
      const id1 = '11111111-1111-1111-1111-111111111111';

      deliveryService.bulkReplayDeliveries.mockResolvedValue({
        total: 1,
        successful: [{ id: id1 }],
        replayed: [{ id: id1 }],
        ineligible: [],
        rejected: [],
        summary: { total: 1, successfulCount: 1, replayedCount: 1, ineligibleCount: 0, rejectedCount: 0 },
      });

      const response = await request(app)
        .post('/deliveries/bulk-replay')
        .send({
          delivery_ids: [id1],
        });

      expect(response.status).toBe(200);
      expect(response.body.successful).toHaveLength(1);
      expect(deliveryService.bulkReplayDeliveries).toHaveBeenCalledWith([id1], mockTenantId);
    });
  });
});

