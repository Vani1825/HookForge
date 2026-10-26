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
});
