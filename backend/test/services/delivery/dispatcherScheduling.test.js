/**
 * Tests for Dispatcher scheduled delivery promotion and worker execution behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { poll, processDelivery } from '../../../src/services/delivery/dispatcher.js';
import deliveryRepository from '../../../src/repositories/jdbc/deliveryRepository.js';
import { findDueEndpoints } from '../../../src/repositories/jdbc/endpointRepository.js';
import { deliveryState } from '../../../src/domain/deliveryState.js';

vi.mock('../../../src/repositories/jdbc/deliveryRepository.js');
vi.mock('../../../src/repositories/jdbc/endpointRepository.js');
vi.mock('../../../src/services/delivery/attemptExecutor.js', () => ({
  default: {
    execute: vi.fn(),
  },
}));
vi.mock('../../../src/services/delivery/outcomeHandler.js', () => ({
  handleOutcome: vi.fn(),
}));
vi.mock('../../../src/services/resilience/thresholdCircuitBreaker.js', () => ({
  shouldAttempt: vi.fn().mockResolvedValue(true),
}));
vi.mock('../../../src/services/resilience/tokenBucketRateLimiter.js', () => ({
  tryAcquire: vi.fn().mockResolvedValue(true),
}));

describe('Dispatcher Scheduling & Worker Execution Behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call promoteDueScheduled during poll() cycle before finding due endpoints', async () => {
    deliveryRepository.promoteDueScheduled.mockResolvedValue(2);
    findDueEndpoints.mockResolvedValue([]);

    await poll();

    expect(deliveryRepository.promoteDueScheduled).toHaveBeenCalledWith(expect.any(Number));
    expect(findDueEndpoints).toHaveBeenCalled();
  });

  it('should handle errors in promoteDueScheduled safely without halting the poll cycle', async () => {
    deliveryRepository.promoteDueScheduled.mockRejectedValue(new Error('DB connection drop'));
    findDueEndpoints.mockResolvedValue([]);

    // poll should not throw uncaught error
    await expect(poll()).resolves.not.toThrow();
    expect(findDueEndpoints).toHaveBeenCalled();
  });

  it('should process newly promoted delivery through existing attemptExecutor and outcomeHandler', async () => {
    const attemptExecutor = (await import('../../../src/services/delivery/attemptExecutor.js')).default;
    const { handleOutcome } = await import('../../../src/services/delivery/outcomeHandler.js');

    const mockEndpoint = {
      id: 'ep-123',
      rateLimitRps: 10,
      circuitState: 'CLOSED',
    };

    const mockDelivery = {
      id: 'del-scheduled-1',
      endpointId: 'ep-123',
      seq: 1,
      state: deliveryState.PENDING,
      attemptCount: 0,
    };

    const mockAttempt = {
      outcome: 'SUCCESS',
      statusCode: 200,
    };

    attemptExecutor.execute.mockResolvedValue(mockAttempt);
    handleOutcome.mockResolvedValue({ ...mockDelivery, state: deliveryState.SUCCEEDED });

    await processDelivery(mockDelivery, mockEndpoint);

    expect(attemptExecutor.execute).toHaveBeenCalledWith(mockDelivery, mockEndpoint);
    expect(handleOutcome).toHaveBeenCalledWith(
      mockDelivery,
      mockAttempt.outcome,
      mockAttempt,
      mockEndpoint
    );
  });
});

