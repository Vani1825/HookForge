/**
 * Tests for LeaseReaper.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { recoverExpiredLeases } from '../../../src/services/resilience/leaseReaper.js';
import deliveryRepository from '../../../src/repositories/jdbc/deliveryRepository.js';
import { deliveryState } from '../../../src/domain/deliveryState.js';
import clock from '../../../src/utils/clock.js';

// Mock deliveryRepository
vi.mock('../../../src/repositories/jdbc/deliveryRepository.js', () => ({
  default: {
    findExpiredLeases: vi.fn(),
    releaseLease: vi.fn(),
  },
}));

describe('LeaseReaper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('recoverExpiredLeases', () => {
    it('should return 0 when no expired leases', async () => {
      deliveryRepository.findExpiredLeases.mockResolvedValue([]);

      const recovered = await recoverExpiredLeases();

      expect(recovered).toBe(0);
      expect(deliveryRepository.findExpiredLeases).toHaveBeenCalled();
      expect(deliveryRepository.releaseLease).not.toHaveBeenCalled();
    });

    it('should recover expired leases to RETRYING', async () => {
      const expiredDeliveries = [
        {
          id: 'delivery-1',
          endpointId: 'endpoint-1',
          seq: 1,
        },
        {
          id: 'delivery-2',
          endpointId: 'endpoint-1',
          seq: 2,
        },
      ];

      deliveryRepository.findExpiredLeases.mockResolvedValue(expiredDeliveries);
      deliveryRepository.releaseLease.mockResolvedValue({ id: 'delivery-1' });

      const recovered = await recoverExpiredLeases();

      expect(recovered).toBe(2);
      expect(deliveryRepository.releaseLease).toHaveBeenCalledTimes(2);
      expect(deliveryRepository.releaseLease).toHaveBeenCalledWith(
        'delivery-1',
        deliveryState.RETRYING,
        expect.any(String),
        'Lease expired - worker crash recovery'
      );
    });

    it('should use provided time source', async () => {
      const testClock = clock.test(1000000);
      const expiredDeliveries = [{ id: 'delivery-1', endpointId: 'endpoint-1', seq: 1 }];

      deliveryRepository.findExpiredLeases.mockResolvedValue(expiredDeliveries);
      deliveryRepository.releaseLease.mockResolvedValue({ id: 'delivery-1' });

      await recoverExpiredLeases(testClock);

      expect(deliveryRepository.findExpiredLeases).toHaveBeenCalledWith(1000000);
    });

    it('should handle partial recovery failures gracefully', async () => {
      const expiredDeliveries = [
        { id: 'delivery-1', endpointId: 'endpoint-1', seq: 1 },
        { id: 'delivery-2', endpointId: 'endpoint-1', seq: 2 },
      ];

      deliveryRepository.findExpiredLeases.mockResolvedValue(expiredDeliveries);
      deliveryRepository.releaseLease
        .mockResolvedValueOnce({ id: 'delivery-1' })
        .mockResolvedValueOnce(null);

      const recovered = await recoverExpiredLeases();

      expect(recovered).toBe(1);
    });
  });
});
