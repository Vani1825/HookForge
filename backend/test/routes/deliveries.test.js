/**
 * Tests for delivery routes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import deliveriesRouter from '../../src/routes/deliveries.js';
import deliveryService from '../../src/services/delivery/deliveryService.js';
import { deliveryState } from '../../src/domain/deliveryState.js';

vi.mock('../../src/services/delivery/deliveryService.js', () => ({
  default: {
    queryDeliveries: vi.fn(),
    getDeliveriesByState: vi.fn(),
    getAllDeliveries: vi.fn(),
    getDeliveryById: vi.fn(),
    replayDelivery: vi.fn(),
  },
}));

function createApp() {
  const app = express();
  app.use(express.json());

  // Mock auth middleware to set tenantId
  app.use((req, res, next) => {
    req.tenantId = '123e4567-e89b-12d3-a456-426614174000';
    next();
  });

  app.use('/deliveries', deliveriesRouter);

  return app;
}

describe('Delivery Routes', () => {
  let app;
  const mockTenantId = '123e4567-e89b-12d3-a456-426614174000';
  const mockDeliveryId = '987e6543-e89b-12d3-a456-426614174999';
  const mockEndpointId = '111e6543-e89b-12d3-a456-426614174111';
  const mockEventId = '222e6543-e89b-12d3-a456-426614174222';

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

<<<<<<< HEAD
  describe('GET /deliveries?state=DEAD', () => {
    it('should return deliveries by state', async () => {
      const mockDeliveries = [
        {
          id: 'delivery-1',
          eventId: 'event-1',
          endpointId: 'endpoint-1',
          endpointUrl: 'https://example.com/webhook',
          lastStatusCode: 504,
          seq: 1,
          state: deliveryState.DEAD,
          attemptCount: 3,
          nextAttemptAt: null,
          lastError: 'Max retries exceeded',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:05:00Z',
=======
  describe('GET /deliveries', () => {
    const mockDeliveries = [
      {
        id: mockDeliveryId,
        eventId: mockEventId,
        endpointId: mockEndpointId,
        seq: 1,
        state: deliveryState.DEAD,
        attemptCount: 3,
        nextAttemptAt: null,
        lastError: 'Max retries exceeded',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:05:00Z',
      },
    ];

    it('should return deliveries with default pagination and default state DEAD', async () => {
      deliveryService.queryDeliveries.mockResolvedValue({
        deliveries: mockDeliveries,
        pagination: {
          page: 1,
          pageSize: 20,
          totalRecords: 1,
          totalPages: 1,
          hasNext: false,
          hasPrev: false,
>>>>>>> a86c7832e5318df24b920b36e7ca39eb2b80ae92
        },
      });

      const response = await request(app).get('/deliveries');

      expect(response.status).toBe(200);
      expect(response.body.state).toBe('DEAD');
      expect(response.body.data).toHaveLength(1);
      expect(response.body.deliveries).toHaveLength(1);
<<<<<<< HEAD
      expect(response.body.deliveries[0].endpoint_url).toBe('https://example.com/webhook');
      expect(response.body.deliveries[0].endpointUrl).toBe('https://example.com/webhook');
      expect(response.body.deliveries[0].last_status_code).toBe(504);
      expect(response.body.deliveries[0].lastStatusCode).toBe(504);
      expect(deliveryService.getDeliveriesByState).toHaveBeenCalledWith('DEAD', 'tenant-1', 100);
=======
      expect(response.body.pagination).toEqual({
        page: 1,
        pageSize: 20,
        totalRecords: 1,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      });
      expect(deliveryService.queryDeliveries).toHaveBeenCalledWith(
        mockTenantId,
        expect.objectContaining({ state: 'DEAD' }),
        { page: 1, pageSize: 20 }
      );
>>>>>>> a86c7832e5318df24b920b36e7ca39eb2b80ae92
    });

    it('should support page and pageSize pagination parameters', async () => {
      deliveryService.queryDeliveries.mockResolvedValue({
        deliveries: mockDeliveries,
        pagination: {
          page: 2,
          pageSize: 10,
          totalRecords: 15,
          totalPages: 2,
          hasNext: false,
          hasPrev: true,
        },
      });

      const response = await request(app).get('/deliveries?page=2&pageSize=10&state=ALL');

      expect(response.status).toBe(200);
      expect(deliveryService.queryDeliveries).toHaveBeenCalledWith(
        mockTenantId,
        expect.objectContaining({ state: 'ALL' }),
        { page: 2, pageSize: 10 }
      );
    });

    it('should support legacy limit and offset parameters', async () => {
      deliveryService.queryDeliveries.mockResolvedValue({
        deliveries: [],
        pagination: {
          page: 3,
          pageSize: 25,
          totalRecords: 100,
          totalPages: 4,
          hasNext: true,
          hasPrev: true,
          offset: 50,
        },
      });

      const response = await request(app).get('/deliveries?limit=25&offset=50');

      expect(response.status).toBe(200);
      expect(deliveryService.queryDeliveries).toHaveBeenCalledWith(
        mockTenantId,
        expect.anything(),
        { page: 3, pageSize: 25, limit: 25, offset: 50 }
      );
      expect(response.body.pagination.offset).toBe(50);
    });

    it('should support arbitrary offset preserving exact skip semantics', async () => {
      deliveryService.queryDeliveries.mockResolvedValue({
        deliveries: [],
        pagination: {
          page: 1,
          pageSize: 20,
          totalRecords: 50,
          totalPages: 3,
          hasNext: true,
          hasPrev: true,
          offset: 5,
        },
      });

      const response = await request(app).get('/deliveries?limit=20&offset=5');

      expect(response.status).toBe(200);
      expect(deliveryService.queryDeliveries).toHaveBeenCalledWith(
        mockTenantId,
        expect.anything(),
        { page: 1, pageSize: 20, limit: 20, offset: 5 }
      );
      expect(response.body.pagination.offset).toBe(5);
    });

    it('should support legacy limit up to 1000 without clamping', async () => {
      deliveryService.queryDeliveries.mockResolvedValue({
        deliveries: [],
        pagination: {
          page: 1,
          pageSize: 500,
          totalRecords: 500,
          totalPages: 1,
          hasNext: false,
          hasPrev: false,
        },
      });

      const response = await request(app).get('/deliveries?limit=500');

      expect(response.status).toBe(200);
      expect(deliveryService.queryDeliveries).toHaveBeenCalledWith(
        mockTenantId,
        expect.anything(),
        { page: 1, pageSize: 500, limit: 500 }
      );
      expect(response.body.pagination.pageSize).toBe(500);
    });

    it('should enforce parameter precedence: pageSize over limit, page over offset', async () => {
      deliveryService.queryDeliveries.mockResolvedValue({
        deliveries: [],
        pagination: {
          page: 2,
          pageSize: 10,
          totalRecords: 50,
          totalPages: 5,
          hasNext: true,
          hasPrev: true,
        },
      });

      const response = await request(app).get('/deliveries?pageSize=10&limit=500&page=2&offset=5');

      expect(response.status).toBe(200);
      expect(deliveryService.queryDeliveries).toHaveBeenCalledWith(
        mockTenantId,
        expect.anything(),
        { page: 2, pageSize: 10 }
      );
      expect(response.body.pagination.pageSize).toBe(10);
      expect(response.body.pagination.page).toBe(2);
      expect(response.body.pagination.offset).toBeUndefined();
    });

    it('should support filtering by endpoint_id and event_id', async () => {
      deliveryService.queryDeliveries.mockResolvedValue({
        deliveries: mockDeliveries,
        pagination: {
          page: 1,
          pageSize: 20,
          totalRecords: 1,
          totalPages: 1,
          hasNext: false,
          hasPrev: false,
        },
      });

      const response = await request(app).get(
        `/deliveries?endpoint_id=${mockEndpointId}&event_id=${mockEventId}&state=ALL`
      );

      expect(response.status).toBe(200);
      expect(deliveryService.queryDeliveries).toHaveBeenCalledWith(
        mockTenantId,
        expect.objectContaining({
          state: 'ALL',
          endpoint_id: mockEndpointId,
          event_id: mockEventId,
        }),
        { page: 1, pageSize: 20 }
      );
    });

    it('should support filtering by date range and search query q', async () => {
      deliveryService.queryDeliveries.mockResolvedValue({
        deliveries: mockDeliveries,
        pagination: {
          page: 1,
          pageSize: 20,
          totalRecords: 1,
          totalPages: 1,
          hasNext: false,
          hasPrev: false,
        },
      });

      const response = await request(app).get(
        '/deliveries?created_after=2024-01-01T00:00:00Z&created_before=2024-01-02T00:00:00Z&q=webhook.site'
      );

      expect(response.status).toBe(200);
      expect(deliveryService.queryDeliveries).toHaveBeenCalledWith(
        mockTenantId,
        expect.objectContaining({
          created_after: '2024-01-01T00:00:00Z',
          created_before: '2024-01-02T00:00:00Z',
          q: 'webhook.site',
        }),
        expect.anything()
      );
    });

    it('should pass pagination and filtering options to deliveryService', async () => {
      deliveryService.getDeliveriesByState.mockResolvedValue([]);

      await request(app).get('/deliveries?state=RETRYING&limit=25&offset=50&endpoint_id=11111111-1111-1111-1111-111111111111&search=timeout');

      expect(deliveryService.getDeliveriesByState).toHaveBeenCalledWith(
        'RETRYING',
        'tenant-1',
        25,
        {
          offset: 50,
          endpointId: '11111111-1111-1111-1111-111111111111',
          search: 'timeout',
        }
      );
    });

    it('should pass options to getAllDeliveries when state is ALL', async () => {
      deliveryService.getAllDeliveries.mockResolvedValue([]);

      await request(app).get('/deliveries?state=ALL&limit=50&offset=10');

      expect(deliveryService.getAllDeliveries).toHaveBeenCalledWith(
        'tenant-1',
        50,
        {
          offset: 10,
          endpointId: null,
          search: null,
        }
      );
    });

    it('should return 400 for invalid state', async () => {
      const response = await request(app).get('/deliveries?state=INVALID');
      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid page number', async () => {
      const response = await request(app).get('/deliveries?page=0');
      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid pageSize exceeding 100', async () => {
      const response = await request(app).get('/deliveries?pageSize=101');
      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid endpoint_id UUID', async () => {
      const response = await request(app).get('/deliveries?endpoint_id=not-a-uuid');
      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid event_id UUID', async () => {
      const response = await request(app).get('/deliveries?event_id=not-a-uuid');
      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid created_after date', async () => {
      const response = await request(app).get('/deliveries?created_after=invalid-date');
      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid created_before date', async () => {
      const response = await request(app).get('/deliveries?created_before=invalid-date');
      expect(response.status).toBe(400);
    });

    it('should return 400 when created_after is later than created_before', async () => {
      const response = await request(app).get(
        '/deliveries?created_after=2024-01-02T00:00:00Z&created_before=2024-01-01T00:00:00Z'
      );
      expect(response.status).toBe(400);
      expect(response.body.message).toContain('created_after cannot be later than created_before');
    });

    it('should accept equal created_after and created_before timestamps', async () => {
      deliveryService.queryDeliveries.mockResolvedValue({
        deliveries: mockDeliveries,
        pagination: {
          page: 1,
          pageSize: 20,
          totalRecords: 1,
          totalPages: 1,
          hasNext: false,
          hasPrev: false,
        },
      });

      const response = await request(app).get(
        '/deliveries?created_after=2024-01-01T00:00:00Z&created_before=2024-01-01T00:00:00Z'
      );
      expect(response.status).toBe(200);
    });

    it('should accept valid date range when created_after is earlier than created_before', async () => {
      deliveryService.queryDeliveries.mockResolvedValue({
        deliveries: mockDeliveries,
        pagination: {
          page: 1,
          pageSize: 20,
          totalRecords: 1,
          totalPages: 1,
          hasNext: false,
          hasPrev: false,
        },
      });

      const response = await request(app).get(
        '/deliveries?created_after=2024-01-01T00:00:00Z&created_before=2024-01-02T00:00:00Z'
      );
      expect(response.status).toBe(200);
    });
  });

  describe('GET /deliveries/:id', () => {
    it('should return delivery with attempts when found', async () => {
      const mockDelivery = {
        id: mockDeliveryId,
        eventId: mockEventId,
        endpointId: mockEndpointId,
        seq: 1,
        state: deliveryState.SUCCEEDED,
        attemptCount: 1,
        nextAttemptAt: null,
        lastError: null,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:01:00Z',
        attempts: [],
      };

      deliveryService.getDeliveryById.mockResolvedValue(mockDelivery);

      const response = await request(app).get(`/deliveries/${mockDeliveryId}`);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(mockDeliveryId);
      expect(response.body.state).toBe('SUCCEEDED');
      expect(deliveryService.getDeliveryById).toHaveBeenCalledWith(mockDeliveryId, mockTenantId);
    });

    it('should return 404 when delivery not found', async () => {
      deliveryService.getDeliveryById.mockResolvedValue(null);

      const response = await request(app).get(`/deliveries/${mockDeliveryId}`);

      expect(response.status).toBe(404);
    });

    it('should return 400 for invalid delivery UUID', async () => {
      const response = await request(app).get('/deliveries/not-a-uuid');

      expect(response.status).toBe(400);
    });
  });

  describe('POST /deliveries/:id/replay', () => {
    it('should replay a DEAD delivery', async () => {
      const mockDelivery = {
<<<<<<< HEAD
        id: 'delivery-1',
        eventId: 'event-1',
        endpointId: 'endpoint-1',
        endpointUrl: 'https://example.com/webhook',
        lastStatusCode: 500,
=======
        id: mockDeliveryId,
        eventId: mockEventId,
        endpointId: mockEndpointId,
>>>>>>> a86c7832e5318df24b920b36e7ca39eb2b80ae92
        seq: 1,
        state: deliveryState.PENDING,
        attemptCount: 0,
        nextAttemptAt: new Date().toISOString(),
        lastError: null,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:06:00Z',
      };

      deliveryService.replayDelivery.mockResolvedValue(mockDelivery);

      const response = await request(app).post(`/deliveries/${mockDeliveryId}/replay`);

      expect(response.status).toBe(200);
<<<<<<< HEAD
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Delivery replayed successfully');
      expect(response.body.delivery).toBeDefined();
      expect(response.body.delivery.id).toBe('delivery-1');
      expect(response.body.delivery.endpoint_url).toBe('https://example.com/webhook');
      expect(response.body.id).toBe('delivery-1');
=======
      expect(response.body.id).toBe(mockDeliveryId);
>>>>>>> a86c7832e5318df24b920b36e7ca39eb2b80ae92
      expect(response.body.state).toBe('PENDING');
      expect(response.body.success).toBe(true);
      expect(deliveryService.replayDelivery).toHaveBeenCalledWith(mockDeliveryId, mockTenantId);
    });

    it('should return 404 when delivery not found', async () => {
      const error = new Error('Delivery not found');
      error.statusCode = 404;
      deliveryService.replayDelivery.mockRejectedValue(error);

      const response = await request(app).post(`/deliveries/${mockDeliveryId}/replay`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Not found');
    });

    it('should return 400 for invalid state transition', async () => {
      const error = new Error('Cannot transition from SUCCEEDED to PENDING');
      error.name = 'IllegalStateTransitionError';
      deliveryService.replayDelivery.mockRejectedValue(error);

      const response = await request(app).post(`/deliveries/${mockDeliveryId}/replay`);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid state transition');
    });

    it('should return 400 for invalid delivery ID', async () => {
      const response = await request(app).post('/deliveries/not-a-uuid/replay');

      expect(response.status).toBe(400);
    });
  });
});
