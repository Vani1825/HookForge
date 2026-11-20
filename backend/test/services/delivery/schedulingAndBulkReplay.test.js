/**
 * Unit tests for Scheduling and Bulk Replay service layer.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import deliveryService from '../../../src/services/delivery/deliveryService.js';
import deliveryRepository from '../../../src/repositories/jdbc/deliveryRepository.js';
import endpointRepository from '../../../src/repositories/jdbc/endpointRepository.js';
import eventRepository from '../../../src/repositories/jdbc/eventRepository.js';
import { deliveryState } from '../../../src/domain/deliveryState.js';
import { IllegalStateTransitionError } from '../../../src/domain/errors/illegalStateTransitionError.js';

vi.mock('../../../src/repositories/jdbc/deliveryRepository.js');
vi.mock('../../../src/repositories/jdbc/endpointRepository.js');
vi.mock('../../../src/repositories/jdbc/eventRepository.js');
vi.mock('../../../src/config/database.js', () => ({
  transaction: vi.fn(async (cb) => cb({})),
  query: vi.fn(),
}));

describe('Scheduling & Bulk Replay Service Layer', () => {
  const mockTenantId = '123e4567-e89b-12d3-a456-426614174000';
  const mockEndpointId = '111e6543-e89b-12d3-a456-426614174111';
  const mockEventId = '222e6543-e89b-12d3-a456-426614174222';
  const mockDeliveryId = '333e6543-e89b-12d3-a456-426614174333';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('scheduleDelivery', () => {
    const futureDate = new Date(Date.now() + 86400000).toISOString(); // +1 day

    it('should schedule a webhook delivery successfully with payload', async () => {
      const mockEndpoint = {
        id: mockEndpointId,
        tenantId: mockTenantId,
        url: 'https://example.com/webhook',
        active: true,
      };

      const mockEvent = {
        id: mockEventId,
        tenantId: mockTenantId,
        payload: { event: 'user.created', id: 42 },
      };

      const mockDelivery = {
        id: mockDeliveryId,
        eventId: mockEventId,
        endpointId: mockEndpointId,
        seq: 5,
        state: deliveryState.SCHEDULED,
        attemptCount: 0,
        scheduledAt: futureDate,
        nextAttemptAt: futureDate,
      };

      endpointRepository.findByIdAndTenant.mockResolvedValue(mockEndpoint);
      endpointRepository.allocate.mockResolvedValue(5);
      eventRepository.insert.mockResolvedValue(mockEvent);
      deliveryRepository.insertScheduledDelivery.mockResolvedValue(mockDelivery);

      const result = await deliveryService.scheduleDelivery(mockTenantId, {
        endpointId: mockEndpointId,
        scheduledAt: futureDate,
        payload: { event: 'user.created', id: 42 },
      });

      expect(endpointRepository.findByIdAndTenant).toHaveBeenCalledWith(mockEndpointId, mockTenantId);
      expect(eventRepository.insert).toHaveBeenCalledWith(
        mockTenantId,
        JSON.stringify({ event: 'user.created', id: 42 }),
        expect.any(String),
        expect.anything()
      );
      expect(endpointRepository.allocate).toHaveBeenCalledWith(mockEndpointId, expect.anything());
      expect(deliveryRepository.insertScheduledDelivery).toHaveBeenCalledWith(
        mockEventId,
        mockEndpointId,
        5,
        expect.any(String),
        expect.anything()
      );
      expect(result.id).toBe(mockDeliveryId);
      expect(result.state).toBe(deliveryState.SCHEDULED);
      expect(result.endpointUrl).toBe('https://example.com/webhook');
    });

    it('should schedule a webhook delivery successfully with existing eventId', async () => {
      const mockEndpoint = {
        id: mockEndpointId,
        tenantId: mockTenantId,
        url: 'https://example.com/webhook',
      };

      const mockEvent = {
        id: mockEventId,
        tenantId: mockTenantId,
      };

      const mockDelivery = {
        id: mockDeliveryId,
        eventId: mockEventId,
        endpointId: mockEndpointId,
        seq: 8,
        state: deliveryState.SCHEDULED,
        scheduledAt: futureDate,
      };

      endpointRepository.findByIdAndTenant.mockResolvedValue(mockEndpoint);
      eventRepository.findById.mockResolvedValue(mockEvent);
      endpointRepository.allocate.mockResolvedValue(8);
      deliveryRepository.insertScheduledDelivery.mockResolvedValue(mockDelivery);

      const result = await deliveryService.scheduleDelivery(mockTenantId, {
        endpoint_id: mockEndpointId,
        scheduled_at: futureDate,
        event_id: mockEventId,
      });

      expect(eventRepository.findById).toHaveBeenCalledWith(mockEventId);
      expect(result.id).toBe(mockDeliveryId);
      expect(result.state).toBe(deliveryState.SCHEDULED);
    });

    it('should reject past scheduled timestamps', async () => {
      const pastDate = new Date(Date.now() - 3600000).toISOString();

      await expect(
        deliveryService.scheduleDelivery(mockTenantId, {
          endpointId: mockEndpointId,
          scheduledAt: pastDate,
          payload: { ping: true },
        })
      ).rejects.toThrow('scheduledAt must be a future date and time');
    });

    it('should reject invalid non-date timestamps', async () => {
      await expect(
        deliveryService.scheduleDelivery(mockTenantId, {
          endpointId: mockEndpointId,
          scheduledAt: 'invalid-not-a-date',
          payload: { ping: true },
        })
      ).rejects.toThrow('scheduledAt must be a valid ISO 8601 date string');
    });

    it('should throw 404 if endpoint does not belong to tenant', async () => {
      endpointRepository.findByIdAndTenant.mockResolvedValue(null);

      await expect(
        deliveryService.scheduleDelivery(mockTenantId, {
          endpointId: mockEndpointId,
          scheduledAt: futureDate,
          payload: { ping: true },
        })
      ).rejects.toThrow('Endpoint not found');
    });

    it('should throw 404 if event does not belong to tenant', async () => {
      endpointRepository.findByIdAndTenant.mockResolvedValue({ id: mockEndpointId });
      eventRepository.findById.mockResolvedValue({ id: mockEventId, tenantId: 'other-tenant' });

      await expect(
        deliveryService.scheduleDelivery(mockTenantId, {
          endpointId: mockEndpointId,
          scheduledAt: futureDate,
          eventId: mockEventId,
        })
      ).rejects.toThrow('Event not found');
    });

    it('should throw 400 if neither eventId nor payload is provided', async () => {
      endpointRepository.findByIdAndTenant.mockResolvedValue({ id: mockEndpointId });

      await expect(
        deliveryService.scheduleDelivery(mockTenantId, {
          endpointId: mockEndpointId,
          scheduledAt: futureDate,
        })
      ).rejects.toThrow('Either eventId or payload must be provided');
    });
  });

  describe('cancelScheduledDelivery', () => {
    it('should cancel a SCHEDULED delivery successfully', async () => {
      const mockDelivery = {
        id: mockDeliveryId,
        endpointId: mockEndpointId,
        state: deliveryState.SCHEDULED,
      };

      const mockCancelled = {
        id: mockDeliveryId,
        endpointId: mockEndpointId,
        state: deliveryState.CANCELLED,
      };

      deliveryRepository.findByIdAndTenant.mockResolvedValue(mockDelivery);
      deliveryRepository.cancelDelivery.mockResolvedValue(mockCancelled);

      const result = await deliveryService.cancelScheduledDelivery(mockDeliveryId, mockTenantId);

      expect(deliveryRepository.findByIdAndTenant).toHaveBeenCalledWith(mockDeliveryId, mockTenantId);
      expect(deliveryRepository.cancelDelivery).toHaveBeenCalledWith(mockDeliveryId, mockTenantId);
      expect(result.state).toBe(deliveryState.CANCELLED);
    });

    it('should cancel a PENDING delivery successfully', async () => {
      const mockDelivery = {
        id: mockDeliveryId,
        endpointId: mockEndpointId,
        state: deliveryState.PENDING,
      };

      const mockCancelled = {
        id: mockDeliveryId,
        endpointId: mockEndpointId,
        state: deliveryState.CANCELLED,
      };

      deliveryRepository.findByIdAndTenant.mockResolvedValue(mockDelivery);
      deliveryRepository.cancelDelivery.mockResolvedValue(mockCancelled);

      const result = await deliveryService.cancelScheduledDelivery(mockDeliveryId, mockTenantId);
      expect(result.state).toBe(deliveryState.CANCELLED);
    });

    it('should throw 404 when cancelling non-existent delivery', async () => {
      deliveryRepository.findByIdAndTenant.mockResolvedValue(null);

      await expect(
        deliveryService.cancelScheduledDelivery(mockDeliveryId, mockTenantId)
      ).rejects.toThrow('Delivery not found');
    });

    it('should throw IllegalStateTransitionError when cancelling SUCCEEDED or DEAD delivery', async () => {
      const mockDelivery = {
        id: mockDeliveryId,
        endpointId: mockEndpointId,
        state: deliveryState.SUCCEEDED,
      };

      deliveryRepository.findByIdAndTenant.mockResolvedValue(mockDelivery);

      await expect(
        deliveryService.cancelScheduledDelivery(mockDeliveryId, mockTenantId)
      ).rejects.toThrow(IllegalStateTransitionError);
    });
  });

  describe('bulkReplayDeliveries', () => {
    it('should replay all DEAD deliveries successfully', async () => {
      const id1 = '11111111-1111-1111-1111-111111111111';
      const id2 = '22222222-2222-2222-2222-222222222222';

      const mockDead1 = { id: id1, endpointId: mockEndpointId, state: deliveryState.DEAD };
      const mockDead2 = { id: id2, endpointId: mockEndpointId, state: deliveryState.DEAD };

      const mockReplayed1 = { id: id1, endpointId: mockEndpointId, state: deliveryState.PENDING, attemptCount: 0 };
      const mockReplayed2 = { id: id2, endpointId: mockEndpointId, state: deliveryState.PENDING, attemptCount: 0 };

      deliveryRepository.findByIdAndTenant
        .mockResolvedValueOnce(mockDead1) // check in bulkReplay
        .mockResolvedValueOnce(mockDead1) // check in replayDelivery
        .mockResolvedValueOnce(mockDead2)
        .mockResolvedValueOnce(mockDead2);

      deliveryRepository.releaseLease
        .mockResolvedValueOnce(mockReplayed1)
        .mockResolvedValueOnce(mockReplayed2);

      const result = await deliveryService.bulkReplayDeliveries([id1, id2], mockTenantId);

      expect(result.total).toBe(2);
      expect(result.successful).toHaveLength(2);
      expect(result.ineligible).toHaveLength(0);
      expect(result.rejected).toHaveLength(0);
      expect(result.summary.successfulCount).toBe(2);
    });

    it('should partition deliveries into successful, ineligible, and rejected', async () => {
      const deadId = '11111111-1111-1111-1111-111111111111';
      const succeededId = '22222222-2222-2222-2222-222222222222';
      const nonExistentId = '33333333-3333-3333-3333-333333333333';

      const mockDead = { id: deadId, endpointId: mockEndpointId, state: deliveryState.DEAD };
      const mockSucceeded = { id: succeededId, endpointId: mockEndpointId, state: deliveryState.SUCCEEDED };

      deliveryRepository.findByIdAndTenant
        .mockResolvedValueOnce(mockDead)
        .mockResolvedValueOnce(mockDead)
        .mockResolvedValueOnce(mockSucceeded)
        .mockResolvedValueOnce(null);

      deliveryRepository.releaseLease.mockResolvedValueOnce({
        id: deadId,
        endpointId: mockEndpointId,
        state: deliveryState.PENDING,
      });

      const result = await deliveryService.bulkReplayDeliveries(
        [deadId, succeededId, nonExistentId],
        mockTenantId
      );

      expect(result.total).toBe(3);
      expect(result.successful).toHaveLength(1);
      expect(result.successful[0].id).toBe(deadId);

      expect(result.ineligible).toHaveLength(1);
      expect(result.ineligible[0].id).toBe(succeededId);
      expect(result.ineligible[0].reason).toContain('only DEAD deliveries are eligible');

      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0].id).toBe(nonExistentId);
      expect(result.rejected[0].reason).toContain('not found');
    });

    it('should deduplicate repeated delivery IDs within request to prevent duplicate execution', async () => {
      const deadId = '11111111-1111-1111-1111-111111111111';
      const mockDead = { id: deadId, endpointId: mockEndpointId, state: deliveryState.DEAD };

      deliveryRepository.findByIdAndTenant
        .mockResolvedValueOnce(mockDead)
        .mockResolvedValueOnce(mockDead);

      deliveryRepository.releaseLease.mockResolvedValueOnce({
        id: deadId,
        state: deliveryState.PENDING,
      });

      const result = await deliveryService.bulkReplayDeliveries(
        [deadId, deadId, deadId],
        mockTenantId
      );

      expect(result.total).toBe(1);
      expect(result.successful).toHaveLength(1);
      expect(deliveryRepository.releaseLease).toHaveBeenCalledTimes(1);
    });

    it('should throw 400 when deliveryIds is not an array', async () => {
      await expect(
        deliveryService.bulkReplayDeliveries('not-an-array', mockTenantId)
      ).rejects.toThrow('deliveryIds must be an array');
    });
  });

  describe('getScheduledDeliveries and getScheduledDeliveryById', () => {
    it('should query deliveries with state SCHEDULED', async () => {
      deliveryRepository.findWithFilters = vi.fn().mockResolvedValue({
        deliveries: [{ id: mockDeliveryId, state: deliveryState.SCHEDULED }],
        totalRecords: 1,
      });

      const result = await deliveryService.getScheduledDeliveries(mockTenantId);

      expect(deliveryRepository.findWithFilters).toHaveBeenCalledWith(
        mockTenantId,
        expect.objectContaining({ state: 'SCHEDULED' }),
        expect.any(Object)
      );
      expect(result.deliveries).toHaveLength(1);
    });

    it('should retrieve scheduled delivery by ID', async () => {
      const mockDelivery = {
        id: mockDeliveryId,
        state: deliveryState.SCHEDULED,
      };

      deliveryRepository.findByIdAndTenant.mockResolvedValue(mockDelivery);
      deliveryRepository.findAttemptsByDeliveryId = vi.fn().mockResolvedValue([]);

      const result = await deliveryService.getScheduledDeliveryById(mockDeliveryId, mockTenantId);

      expect(deliveryRepository.findByIdAndTenant).toHaveBeenCalledWith(mockDeliveryId, mockTenantId);
      expect(result.id).toBe(mockDeliveryId);
    });
  });
});

