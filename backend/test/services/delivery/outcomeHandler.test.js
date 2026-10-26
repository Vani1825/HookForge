/**
 * Tests for OutcomeHandler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleOutcome } from '../../../src/services/delivery/outcomeHandler.js';
import deliveryRepository from '../../../src/repositories/jdbc/deliveryRepository.js';
import { saveCircuit } from '../../../src/repositories/jdbc/endpointRepository.js';
import { deliveryOutcome } from '../../../src/domain/deliveryOutcome.js';
import { deliveryState } from '../../../src/domain/deliveryState.js';
import { circuitState } from '../../../src/domain/circuitState.js';
import exponentialJitterRetryPolicy from '../../../src/services/resilience/exponentialJitterRetryPolicy.js';
import thresholdCircuitBreaker from '../../../src/services/resilience/thresholdCircuitBreaker.js';
import clock from '../../../src/utils/clock.js';

// Mock dependencies
vi.mock('../../../src/repositories/jdbc/deliveryRepository.js');
vi.mock('../../../src/repositories/jdbc/endpointRepository.js');
vi.mock('../../../src/services/resilience/exponentialJitterRetryPolicy.js');
vi.mock('../../../src/services/resilience/thresholdCircuitBreaker.js');

describe('OutcomeHandler', () => {
  const mockDelivery = {
    id: 'delivery-1',
    eventId: 'event-1',
    endpointId: 'endpoint-1',
    seq: 1,
    state: deliveryState.IN_FLIGHT,
    attemptCount: 0,
  };

  const mockEndpoint = {
    id: 'endpoint-1',
    circuitState: circuitState.CLOSED,
    circuitUntil: null,
    consecutiveFailures: 0,
  };

  const mockAttempt = {
    startedAt: new Date().toISOString(),
    statusCode: 200,
    latencyMs: 100,
    error: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleOutcome with SUCCESS', () => {
    it('should mark delivery as SUCCEEDED', async () => {
      exponentialJitterRetryPolicy.nextDelay.mockResolvedValue(null);
      thresholdCircuitBreaker.recordResult.mockResolvedValue({
        circuitState: circuitState.CLOSED,
        circuitUntil: null,
        consecutiveFailures: 0,
      });

      await handleOutcome(mockDelivery, deliveryOutcome.SUCCESS, mockAttempt, mockEndpoint);

      expect(deliveryRepository.recordAttempt).toHaveBeenCalledWith({
        deliveryId: 'delivery-1',
        attemptNo: 1,
        startedAt: mockAttempt.startedAt,
        statusCode: mockAttempt.statusCode,
        latencyMs: mockAttempt.latencyMs,
        error: mockAttempt.error,
      });
      expect(deliveryRepository.incrementAttemptCount).toHaveBeenCalledWith('delivery-1');
      expect(deliveryRepository.markTerminal).toHaveBeenCalledWith('delivery-1', deliveryState.SUCCEEDED);
    });

    it('should update circuit breaker on success', async () => {
      exponentialJitterRetryPolicy.nextDelay.mockResolvedValue(null);
      thresholdCircuitBreaker.recordResult.mockResolvedValue({
        circuitState: circuitState.CLOSED,
        circuitUntil: null,
        consecutiveFailures: 0,
      });

      await handleOutcome(mockDelivery, deliveryOutcome.SUCCESS, mockAttempt, mockEndpoint);

      expect(thresholdCircuitBreaker.recordResult).toHaveBeenCalledWith(
        'endpoint-1',
        deliveryOutcome.SUCCESS,
        mockEndpoint,
        expect.any(Number)
      );
      expect(saveCircuit).toHaveBeenCalledWith('endpoint-1', {
        circuitState: circuitState.CLOSED,
        circuitUntil: null,
        consecutiveFailures: 0,
      });
    });
  });

  describe('handleOutcome with ENDPOINT_GONE', () => {
    it('should mark delivery as DEAD', async () => {
      exponentialJitterRetryPolicy.nextDelay.mockResolvedValue(null);
      thresholdCircuitBreaker.recordResult.mockResolvedValue(null);

      await handleOutcome(mockDelivery, deliveryOutcome.ENDPOINT_GONE, mockAttempt, mockEndpoint);

      expect(deliveryRepository.markTerminal).toHaveBeenCalledWith('delivery-1', deliveryState.DEAD);
    });
  });

  describe('handleOutcome with retryable failure', () => {
    it('should schedule retry when delay available', async () => {
      exponentialJitterRetryPolicy.nextDelay.mockResolvedValue(5000);
      thresholdCircuitBreaker.recordResult.mockResolvedValue(null);

      await handleOutcome(mockDelivery, deliveryOutcome.RETRY, mockAttempt, mockEndpoint);

      expect(deliveryRepository.releaseLease).toHaveBeenCalledWith(
        'delivery-1',
        deliveryState.RETRYING,
        expect.any(String),
        'Retryable failure'
      );
    });

    it('should mark as DEAD when retry limit exceeded', async () => {
      exponentialJitterRetryPolicy.nextDelay.mockResolvedValue(null);
      thresholdCircuitBreaker.recordResult.mockResolvedValue(null);

      await handleOutcome(mockDelivery, deliveryOutcome.RETRY, mockAttempt, mockEndpoint);

      expect(deliveryRepository.markTerminal).toHaveBeenCalledWith('delivery-1', deliveryState.DEAD);
    });
  });

  describe('handleOutcome with RATE_LIMITED', () => {
    it('should schedule retry with delay', async () => {
      exponentialJitterRetryPolicy.nextDelay.mockResolvedValue(1000);
      thresholdCircuitBreaker.recordResult.mockResolvedValue(null);

      await handleOutcome(mockDelivery, deliveryOutcome.RATE_LIMITED, mockAttempt, mockEndpoint);

      expect(deliveryRepository.releaseLease).toHaveBeenCalledWith(
        'delivery-1',
        deliveryState.RETRYING,
        expect.any(String),
        'Retryable failure'
      );
    });
  });

  describe('handleOutcome with RETRY_LIMITED', () => {
    it('should respect RETRY_LIMITED max attempts (3)', async () => {
      const deliveryWithAttempts = { ...mockDelivery, attemptCount: 2 };
      
      exponentialJitterRetryPolicy.nextDelay.mockResolvedValue(null);
      thresholdCircuitBreaker.recordResult.mockResolvedValue(null);

      await handleOutcome(deliveryWithAttempts, deliveryOutcome.RETRY_LIMITED, mockAttempt, mockEndpoint);

      expect(deliveryRepository.markTerminal).toHaveBeenCalledWith('delivery-1', deliveryState.DEAD);
    });
  });
});
