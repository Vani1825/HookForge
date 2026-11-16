/**
 * Tests for DeliveryService.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import deliveryService from '../../../src/services/delivery/deliveryService.js';
import deliveryRepository from '../../../src/repositories/jdbc/deliveryRepository.js';
import { deliveryState } from '../../../src/domain/deliveryState.js';
import { IllegalStateTransitionError } from '../../../src/domain/errors/illegalStateTransitionError.js';

// Mock deliveryRepository
vi.mock('../../../src/repositories/jdbc/deliveryRepository.js');

describe('DeliveryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getDeliveriesByEvent', () => {
    it('should return deliveries for an event with tenant scope', async () => {
      const mockDeliveries = [
        { id: 'delivery-1', eventId: 'event-1', endpointId: 'endpoint-1', seq: 1 },
        { id: 'delivery-2', eventId: 'event-1', endpointId: 'endpoint-2', seq: 2 },
      ];

      deliveryRepository.findByEvent.mockResolvedValue(mockDeliveries);

      const deliveries = await deliveryService.getDeliveriesByEvent('event-1', 'tenant-1');

      expect(deliveryRepository.findByEvent).toHaveBeenCalledWith('event-1', 'tenant-1');
      expect(deliveries).toEqual(mockDeliveries);
    });
  });

  describe('getDeliveriesByState', () => {
    it('should return deliveries by state with tenant scope', async () => {
      const mockDeliveries = [
        { id: 'delivery-1', state: deliveryState.DEAD },
        { id: 'delivery-2', state: deliveryState.DEAD },
      ];

      deliveryRepository.findByState.mockResolvedValue(mockDeliveries);

      const deliveries = await deliveryService.getDeliveriesByState('DEAD', 'tenant-1', 100);

      expect(deliveryRepository.findByState).toHaveBeenCalledWith(deliveryState.DEAD, 'tenant-1', 100);
      expect(deliveries).toEqual(mockDeliveries);
    });

    it('should use default limit of 100', async () => {
      deliveryRepository.findByState.mockResolvedValue([]);

      await deliveryService.getDeliveriesByState('DEAD', 'tenant-1');

      expect(deliveryRepository.findByState).toHaveBeenCalledWith(deliveryState.DEAD, 'tenant-1', 100);
    });
  });

  describe('replayDelivery', () => {
    it('should replay a DEAD delivery', async () => {
      const mockDelivery = {
        id: 'delivery-1',
        eventId: 'event-1',
        endpointId: 'endpoint-1',
        seq: 1,
        state: deliveryState.DEAD,
      };

      const mockUpdated = {
        id: 'delivery-1',
        state: deliveryState.PENDING,
      };

      deliveryRepository.findByIdAndTenant.mockResolvedValue(mockDelivery);
      deliveryRepository.releaseLease.mockResolvedValue(mockUpdated);

      const result = await deliveryService.replayDelivery('delivery-1', 'tenant-1');

      expect(deliveryRepository.findByIdAndTenant).toHaveBeenCalledWith('delivery-1', 'tenant-1');
      expect(deliveryRepository.releaseLease).toHaveBeenCalledWith(
        'delivery-1',
        deliveryState.PENDING,
        expect.any(String),
        null
      );
      expect(result).toEqual(mockUpdated);
    });

    it('should preserve endpointUrl and lastStatusCode when replaying', async () => {
      const mockDelivery = {
        id: 'delivery-1',
        eventId: 'event-1',
        endpointId: 'endpoint-1',
        endpointUrl: 'https://webhook.example.com/endpoint',
        lastStatusCode: 504,
        seq: 1,
        state: deliveryState.DEAD,
      };

      const mockUpdated = {
        id: 'delivery-1',
        state: deliveryState.PENDING,
      };

      deliveryRepository.findByIdAndTenant.mockResolvedValue(mockDelivery);
      deliveryRepository.releaseLease.mockResolvedValue(mockUpdated);

      const result = await deliveryService.replayDelivery('delivery-1', 'tenant-1');

      expect(result.endpointUrl).toBe('https://webhook.example.com/endpoint');
      expect(result.lastStatusCode).toBe(504);
    });

    it('should throw 404 when delivery not found', async () => {
      deliveryRepository.findByIdAndTenant.mockResolvedValue(null);

      await expect(deliveryService.replayDelivery('delivery-1', 'tenant-1')).rejects.toThrow('Delivery not found');
    });

    it('should throw IllegalStateTransitionError when delivery is not DEAD', async () => {
      const mockDelivery = {
        id: 'delivery-1',
        state: deliveryState.SUCCEEDED,
      };

      deliveryRepository.findByIdAndTenant.mockResolvedValue(mockDelivery);

      await expect(deliveryService.replayDelivery('delivery-1', 'tenant-1')).rejects.toThrow(
        IllegalStateTransitionError
      );
    });

    it('should enforce tenant scope', async () => {
      deliveryRepository.findByIdAndTenant.mockResolvedValue(null);

      await expect(deliveryService.replayDelivery('delivery-1', 'tenant-1')).rejects.toThrow('Delivery not found');

      expect(deliveryRepository.findByIdAndTenant).toHaveBeenCalledWith('delivery-1', 'tenant-1');
    });
  });

  describe('queryDeliveries', () => {
    it('should query deliveries with default pagination and filters', async () => {
      const mockDeliveries = [
        { id: 'delivery-1', state: deliveryState.DEAD },
      ];
      deliveryRepository.findWithFilters.mockResolvedValue({
        deliveries: mockDeliveries,
        totalRecords: 1,
      });

      const result = await deliveryService.queryDeliveries('tenant-1', { state: 'DEAD' });

      expect(deliveryRepository.findWithFilters).toHaveBeenCalledWith(
        'tenant-1',
        { state: 'DEAD' },
        { page: 1, pageSize: 20 }
      );
      expect(result.deliveries).toEqual(mockDeliveries);
      expect(result.pagination).toEqual({
        page: 1,
        pageSize: 20,
        totalRecords: 1,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      });
    });

    it('should calculate pagination envelope correctly for multi-page results', async () => {
      deliveryRepository.findWithFilters.mockResolvedValue({
        deliveries: [],
        totalRecords: 45,
      });

      const result = await deliveryService.queryDeliveries(
        'tenant-1',
        {},
        { page: 2, pageSize: 20 }
      );

      expect(result.pagination).toEqual({
        page: 2,
        pageSize: 20,
        totalRecords: 45,
        totalPages: 3,
        hasNext: true,
        hasPrev: true,
      });
    });

    it('should handle zero total records properly', async () => {
      deliveryRepository.findWithFilters.mockResolvedValue({
        deliveries: [],
        totalRecords: 0,
      });

      const result = await deliveryService.queryDeliveries('tenant-1');

      expect(result.pagination.totalPages).toBe(0);
      expect(result.pagination.hasNext).toBe(false);
      expect(result.pagination.hasPrev).toBe(false);
    });

    it('should support arbitrary offset preserving exact skip semantics', async () => {
      deliveryRepository.findWithFilters.mockResolvedValue({
        deliveries: [{ id: 'del-1' }],
        totalRecords: 50,
      });

      const result = await deliveryService.queryDeliveries(
        'tenant-1',
        {},
        { limit: 20, offset: 5 }
      );

      expect(deliveryRepository.findWithFilters).toHaveBeenCalledWith(
        'tenant-1',
        {},
        { page: 1, pageSize: 20, limit: 20, offset: 5 }
      );
      expect(result.pagination).toEqual({
        page: 1,
        pageSize: 20,
        totalRecords: 50,
        totalPages: 3,
        hasNext: true,
        hasPrev: true,
        offset: 5,
      });
    });

    it('should support legacy limit up to 1000 without clamping', async () => {
      deliveryRepository.findWithFilters.mockResolvedValue({
        deliveries: [],
        totalRecords: 500,
      });

      const result = await deliveryService.queryDeliveries(
        'tenant-1',
        {},
        { limit: 500 }
      );

      expect(deliveryRepository.findWithFilters).toHaveBeenCalledWith(
        'tenant-1',
        {},
        { page: 1, pageSize: 500, limit: 500 }
      );
      expect(result.pagination.pageSize).toBe(500);
    });

    it('should enforce parameter precedence: pageSize over limit, page over offset', async () => {
      deliveryRepository.findWithFilters.mockResolvedValue({
        deliveries: [],
        totalRecords: 50,
      });

      const result = await deliveryService.queryDeliveries(
        'tenant-1',
        {},
        { pageSize: 10, limit: 500, page: 2, offset: 5 }
      );

      expect(deliveryRepository.findWithFilters).toHaveBeenCalledWith(
        'tenant-1',
        {},
        { page: 2, pageSize: 10 }
      );
      expect(result.pagination.pageSize).toBe(10);
      expect(result.pagination.page).toBe(2);
      expect(result.pagination.offset).toBeUndefined();
    });
  });
});
