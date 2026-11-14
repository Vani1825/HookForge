/**
 * Tests for LeaseReaper.
 * Verifies batch recovery of expired IN_FLIGHT leases and retry/dead-letter behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { recoverExpiredLeases } from '../../../src/services/resilience/leaseReaper.js';
import deliveryRepository from '../../../src/repositories/jdbc/deliveryRepository.js';
import clock from '../../../src/utils/clock.js';

// Mock deliveryRepository
vi.mock('../../../src/repositories/jdbc/deliveryRepository.js', () => ({
  default: {
    recoverExpiredLeasesBatch: vi.fn(),
    findExpiredLeases: vi.fn(),
    releaseLease: vi.fn(),
  },
}));

describe('LeaseReaper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('recoverExpiredLeases', () => {
    it('should return 0 when no expired leases exist', async () => {
      deliveryRepository.recoverExpiredLeasesBatch.mockResolvedValue([]);

      const recovered = await recoverExpiredLeases();

      expect(recovered).toBe(0);
      expect(deliveryRepository.recoverExpiredLeasesBatch).toHaveBeenCalledTimes(1);
    });

    it('should recover multiple expired leases in a single batch', async () => {
      const recoveredDeliveries = [
        { id: 'delivery-1', endpointId: 'endpoint-1', seq: 1, state: 'RETRYING', attemptCount: 1 },
        { id: 'delivery-2', endpointId: 'endpoint-1', seq: 2, state: 'RETRYING', attemptCount: 2 },
      ];

      deliveryRepository.recoverExpiredLeasesBatch.mockResolvedValue(recoveredDeliveries);

      const recovered = await recoverExpiredLeases();

      expect(recovered).toBe(2);
      expect(deliveryRepository.recoverExpiredLeasesBatch).toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number), // batchSize
        expect.any(Number)  // maxAttempts
      );
    });

    it('should use provided time source and custom options', async () => {
      const testClock = clock.test(1000000);
      deliveryRepository.recoverExpiredLeasesBatch.mockResolvedValue([
        { id: 'delivery-1', endpointId: 'endpoint-1', seq: 1, state: 'RETRYING', attemptCount: 1 },
      ]);

      const recovered = await recoverExpiredLeases(testClock, { batchSize: 50, maxAttempts: 5 });

      expect(recovered).toBe(1);
      expect(deliveryRepository.recoverExpiredLeasesBatch).toHaveBeenCalledWith(
        1000000,
        50,
        5
      );
    });

    it('should recover exhausted leases to DEAD and retryable leases to RETRYING', async () => {
      const recoveredMix = [
        { id: 'delivery-retry', endpointId: 'endpoint-1', seq: 1, state: 'RETRYING', attemptCount: 2 },
        { id: 'delivery-dead', endpointId: 'endpoint-2', seq: 1, state: 'DEAD', attemptCount: 8 },
      ];

      deliveryRepository.recoverExpiredLeasesBatch.mockResolvedValue(recoveredMix);

      const recovered = await recoverExpiredLeases();

      expect(recovered).toBe(2);
      expect(deliveryRepository.recoverExpiredLeasesBatch).toHaveBeenCalledTimes(1);
    });

    it('should handle repeated worker crashes reaching the retry limit', async () => {
      // Simulate multi-cycle reaper invocations across consecutive worker crashes
      const testClock = clock.test(2000000);
      const crashCycle = [
        // Cycle 1: Worker crash 1 -> recovered to RETRYING (attemptCount: 1)
        [{ id: 'del-repeat', endpointId: 'ep-1', seq: 1, state: 'RETRYING', attemptCount: 1 }],
        // Cycle 2: Worker crash 2 -> recovered to RETRYING (attemptCount: 2)
        [{ id: 'del-repeat', endpointId: 'ep-1', seq: 1, state: 'RETRYING', attemptCount: 2 }],
        // Cycle 3: Worker crash 3 -> reaches maxAttempts (3) -> transitioned to DEAD
        [{ id: 'del-repeat', endpointId: 'ep-1', seq: 1, state: 'DEAD', attemptCount: 3 }],
      ];

      deliveryRepository.recoverExpiredLeasesBatch
        .mockResolvedValueOnce(crashCycle[0])
        .mockResolvedValueOnce(crashCycle[1])
        .mockResolvedValueOnce(crashCycle[2]);

      const cycle1 = await recoverExpiredLeases(testClock, { maxAttempts: 3 });
      expect(cycle1).toBe(1);

      const cycle2 = await recoverExpiredLeases(testClock, { maxAttempts: 3 });
      expect(cycle2).toBe(1);

      const cycle3 = await recoverExpiredLeases(testClock, { maxAttempts: 3 });
      expect(cycle3).toBe(1);

      expect(deliveryRepository.recoverExpiredLeasesBatch).toHaveBeenCalledTimes(3);
    });

    it('should propagate database failure during batch recovery', async () => {
      deliveryRepository.recoverExpiredLeasesBatch.mockRejectedValue(new Error('DB failure during lease reaper'));

      await expect(recoverExpiredLeases()).rejects.toThrow('DB failure during lease reaper');
    });
  });
});
