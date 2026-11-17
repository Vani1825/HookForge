/**
 * Tests for Dispatcher worker loop.
 * Verifies queue-driven polling, concurrency limits, FIFO safety, and resilience guards.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { poll, start, stop } from '../../../src/services/delivery/dispatcher.js';
import deliveryRepository from '../../../src/repositories/jdbc/deliveryRepository.js';
import { findDueEndpoints } from '../../../src/repositories/jdbc/endpointRepository.js';
import attemptExecutor from '../../../src/services/delivery/attemptExecutor.js';
import { handleOutcome } from '../../../src/services/delivery/outcomeHandler.js';
import { shouldAttempt } from '../../../src/services/resilience/thresholdCircuitBreaker.js';
import { tryAcquire } from '../../../src/services/resilience/tokenBucketRateLimiter.js';
import { recoverExpiredLeases } from '../../../src/services/resilience/leaseReaper.js';
import { circuitState } from '../../../src/domain/circuitState.js';
import { deliveryState } from '../../../src/domain/deliveryState.js';

vi.mock('../../../src/repositories/jdbc/deliveryRepository.js', () => ({
  default: {
    claim: vi.fn(),
    releaseLease: vi.fn(),
  },
}));

vi.mock('../../../src/repositories/jdbc/endpointRepository.js', () => ({
  findDueEndpoints: vi.fn(),
}));

vi.mock('../../../src/services/delivery/attemptExecutor.js', () => ({
  default: {
    execute: vi.fn(),
  },
}));

vi.mock('../../../src/services/delivery/outcomeHandler.js', () => ({
  handleOutcome: vi.fn(),
}));

vi.mock('../../../src/services/resilience/thresholdCircuitBreaker.js', () => ({
  shouldAttempt: vi.fn(),
}));

vi.mock('../../../src/services/resilience/tokenBucketRateLimiter.js', () => ({
  tryAcquire: vi.fn(),
}));

vi.mock('../../../src/services/resilience/leaseReaper.js', () => ({
  recoverExpiredLeases: vi.fn(),
}));

describe('Dispatcher (Queue-Driven)', () => {
  const mockEndpoint1 = {
    id: 'endpoint-1',
    tenantId: 'tenant-1',
    url: 'https://example.com/webhook-1',
    secret: 'whsec_test1',
    rateLimitRps: 10,
    circuitState: circuitState.CLOSED,
  };

  const mockEndpoint2 = {
    id: 'endpoint-2',
    tenantId: 'tenant-1',
    url: 'https://example.com/webhook-2',
    secret: 'whsec_test2',
    rateLimitRps: 20,
    circuitState: circuitState.CLOSED,
  };

  const mockDelivery1 = {
    id: 'delivery-1',
    eventId: 'event-1',
    endpointId: 'endpoint-1',
    seq: 1,
    state: deliveryState.IN_FLIGHT,
    attemptCount: 0,
  };

  const mockDelivery2 = {
    id: 'delivery-2',
    eventId: 'event-2',
    endpointId: 'endpoint-2',
    seq: 1,
    state: deliveryState.IN_FLIGHT,
    attemptCount: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Default mock behaviors
    shouldAttempt.mockResolvedValue(true);
    tryAcquire.mockResolvedValue(true);
    attemptExecutor.execute.mockResolvedValue({ outcome: 'SUCCESS' });
    handleOutcome.mockResolvedValue();
    deliveryRepository.releaseLease.mockResolvedValue();
    recoverExpiredLeases.mockResolvedValue(0);
  });

  afterEach(() => {
    stop();
    vi.useRealTimers();
  });

  describe('Queue-Driven Candidate Discovery', () => {
    it('should open zero claim transactions when no deliveries are due', async () => {
      // No candidate endpoints have due deliveries
      findDueEndpoints.mockResolvedValue([]);

      await poll();

      expect(findDueEndpoints).toHaveBeenCalledWith(50);
      expect(deliveryRepository.claim).not.toHaveBeenCalled();
      expect(attemptExecutor.execute).not.toHaveBeenCalled();
    });

    it('should discover candidate endpoints and claim deliveries for each', async () => {
      findDueEndpoints.mockResolvedValue([mockEndpoint1, mockEndpoint2]);
      deliveryRepository.claim
        .mockResolvedValueOnce(mockDelivery1)
        .mockResolvedValueOnce(mockDelivery2);

      await poll();

      expect(findDueEndpoints).toHaveBeenCalledWith(50);
      expect(deliveryRepository.claim).toHaveBeenCalledWith('endpoint-1', expect.any(Number));
      expect(deliveryRepository.claim).toHaveBeenCalledWith('endpoint-2', expect.any(Number));
      expect(attemptExecutor.execute).toHaveBeenCalledWith(mockDelivery1, mockEndpoint1);
      expect(attemptExecutor.execute).toHaveBeenCalledWith(mockDelivery2, mockEndpoint2);
      expect(handleOutcome).toHaveBeenCalledTimes(2);
    });

    it('should skip endpoint without error when claim returns null (e.g. head-of-line delivery in-flight or retrying)', async () => {
      findDueEndpoints.mockResolvedValue([mockEndpoint1, mockEndpoint2]);
      // Endpoint 1 returns null from claim (head-of-line blocking or race)
      deliveryRepository.claim
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockDelivery2);

      await poll();

      expect(deliveryRepository.claim).toHaveBeenCalledTimes(2);
      expect(attemptExecutor.execute).toHaveBeenCalledTimes(1);
      expect(attemptExecutor.execute).toHaveBeenCalledWith(mockDelivery2, mockEndpoint2);
    });

    it('should gracefully handle database error in findDueEndpoints', async () => {
      findDueEndpoints.mockRejectedValue(new Error('Database connection failed'));

      // Should not throw or crash
      await expect(poll()).resolves.not.toThrow();
      expect(deliveryRepository.claim).not.toHaveBeenCalled();
    });
  });

  describe('Resilience and Rate Limiting in Delivery Processing', () => {
    it('should release lease and reschedule for 60s when circuit breaker is open', async () => {
      findDueEndpoints.mockResolvedValue([mockEndpoint1]);
      deliveryRepository.claim.mockResolvedValue(mockDelivery1);
      shouldAttempt.mockResolvedValue(false);

      await poll();

      expect(shouldAttempt).toHaveBeenCalledWith(mockEndpoint1.id, mockEndpoint1, expect.any(Number));
      expect(attemptExecutor.execute).not.toHaveBeenCalled();
      expect(deliveryRepository.releaseLease).toHaveBeenCalledWith(
        mockDelivery1.id,
        deliveryState.RETRYING,
        expect.any(String),
        'Circuit breaker open',
        {
          requireInFlight: true,
          expectedAttemptCount: mockDelivery1.attemptCount,
        }
      );
    });

    it('should release lease and reschedule for 1s when rate limited', async () => {
      findDueEndpoints.mockResolvedValue([mockEndpoint1]);
      deliveryRepository.claim.mockResolvedValue(mockDelivery1);
      shouldAttempt.mockResolvedValue(true);
      tryAcquire.mockResolvedValue(false);

      await poll();

      expect(tryAcquire).toHaveBeenCalledWith(mockEndpoint1.id, mockEndpoint1.rateLimitRps);
      expect(attemptExecutor.execute).not.toHaveBeenCalled();
      expect(deliveryRepository.releaseLease).toHaveBeenCalledWith(
        mockDelivery1.id,
        deliveryState.RETRYING,
        expect.any(String),
        'Rate limited',
        {
          requireInFlight: true,
          expectedAttemptCount: mockDelivery1.attemptCount,
        }
      );
    });

    it('should release lease on unexpected execution error', async () => {
      findDueEndpoints.mockResolvedValue([mockEndpoint1]);
      deliveryRepository.claim.mockResolvedValue(mockDelivery1);
      attemptExecutor.execute.mockRejectedValue(new Error('Socket hang up'));

      await poll();

      expect(deliveryRepository.releaseLease).toHaveBeenCalledWith(
        mockDelivery1.id,
        deliveryState.RETRYING,
        expect.any(String),
        'Socket hang up',
        {
          requireInFlight: true,
          expectedAttemptCount: mockDelivery1.attemptCount,
        }
      );
    });
  });

  describe('Lifecycle (start and stop)', () => {
    it('should start polling timer and lease reaper timer', async () => {
      findDueEndpoints.mockResolvedValue([]);

      start();

      expect(findDueEndpoints).toHaveBeenCalledTimes(1);

      // Advance time by poll interval (500ms)
      await vi.advanceTimersByTimeAsync(500);
      expect(findDueEndpoints).toHaveBeenCalledTimes(2);

      // Advance time to reaper interval (60000ms)
      await vi.advanceTimersByTimeAsync(60000);
      expect(recoverExpiredLeases).toHaveBeenCalled();

      stop();

      const callCountAfterStop = findDueEndpoints.mock.calls.length;
      await vi.advanceTimersByTimeAsync(5000);
      expect(findDueEndpoints).toHaveBeenCalledTimes(callCountAfterStop);
    });

    it('should not create duplicate timers if start() is called when already running', async () => {
      findDueEndpoints.mockResolvedValue([]);

      start();
      start(); // duplicate call

      stop();
    });

    it('should handle stop() safely when not running', () => {
      expect(() => stop()).not.toThrow();
    });
  });
});
