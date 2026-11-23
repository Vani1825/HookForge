/**
 * Comprehensive tests for Custom Retry Policies:
 * - FixedDelayRetryPolicy
 * - Configurable ExponentialJitterRetryPolicy
 * - resolveRetryPolicy factory
 * - OutcomeHandler integration with custom endpoint policies
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createFixedDelayRetryPolicy,
  defaultFixedDelayRetryPolicy,
} from '../../../src/services/resilience/fixedDelayRetryPolicy.js';
import exponentialJitterRetryPolicy, {
  createExponentialJitterRetryPolicy,
} from '../../../src/services/resilience/exponentialJitterRetryPolicy.js';
import { resolveRetryPolicy } from '../../../src/services/resilience/retryPolicyFactory.js';
import { handleOutcome } from '../../../src/services/delivery/outcomeHandler.js';
import deliveryRepository from '../../../src/repositories/jdbc/deliveryRepository.js';
import { deliveryOutcome } from '../../../src/domain/deliveryOutcome.js';
import { deliveryState } from '../../../src/domain/deliveryState.js';
import { circuitState } from '../../../src/domain/circuitState.js';
import thresholdCircuitBreaker from '../../../src/services/resilience/thresholdCircuitBreaker.js';
import randomGenerator from '../../../src/utils/random.js';

// Mock repositories and circuit breaker for outcome handler tests
vi.mock('../../../src/repositories/jdbc/deliveryRepository.js');
vi.mock('../../../src/repositories/jdbc/endpointRepository.js');
vi.mock('../../../src/services/resilience/thresholdCircuitBreaker.js');

describe('Custom Retry Policies', () => {
  describe('FixedDelayRetryPolicy', () => {
    it('should return constant delay for retryable outcomes', async () => {
      const policy = createFixedDelayRetryPolicy({
        delayMs: 3000,
        maxAttempts: 5,
      });

      expect(policy.strategy).toBe('FIXED');
      expect(policy.delayMs).toBe(3000);
      expect(policy.maxAttempts).toBe(5);

      const delay1 = await policy.nextDelay(1, deliveryOutcome.RETRY);
      expect(delay1).toBe(3000);

      const delay2 = await policy.nextDelay(2, deliveryOutcome.RATE_LIMITED);
      expect(delay2).toBe(3000);

      const delay4 = await policy.nextDelay(4, deliveryOutcome.RETRY);
      expect(delay4).toBe(3000);
    });

    it('should return null for SUCCESS outcome', async () => {
      const policy = createFixedDelayRetryPolicy({ delayMs: 2000, maxAttempts: 5 });
      const delay = await policy.nextDelay(1, deliveryOutcome.SUCCESS);
      expect(delay).toBeNull();
    });

    it('should return null for ENDPOINT_GONE outcome', async () => {
      const policy = createFixedDelayRetryPolicy({ delayMs: 2000, maxAttempts: 5 });
      const delay = await policy.nextDelay(1, deliveryOutcome.ENDPOINT_GONE);
      expect(delay).toBeNull();
    });

    it('should return null when max attempts are exceeded', async () => {
      const policy = createFixedDelayRetryPolicy({
        delayMs: 1500,
        maxAttempts: 3,
      });

      expect(await policy.nextDelay(1, deliveryOutcome.RETRY)).toBe(1500);
      expect(await policy.nextDelay(2, deliveryOutcome.RETRY)).toBe(1500);
      expect(await policy.nextDelay(3, deliveryOutcome.RETRY)).toBeNull();
      expect(await policy.nextDelay(4, deliveryOutcome.RETRY)).toBeNull();
    });

    it('should respect RETRY_LIMITED max attempts (min of 3 and maxAttempts)', async () => {
      const policyHighMax = createFixedDelayRetryPolicy({
        delayMs: 1000,
        maxAttempts: 10,
      });

      expect(await policyHighMax.nextDelay(1, deliveryOutcome.RETRY_LIMITED)).toBe(1000);
      expect(await policyHighMax.nextDelay(2, deliveryOutcome.RETRY_LIMITED)).toBe(1000);
      expect(await policyHighMax.nextDelay(3, deliveryOutcome.RETRY_LIMITED)).toBeNull();

      const policyLowMax = createFixedDelayRetryPolicy({
        delayMs: 1000,
        maxAttempts: 2,
      });

      expect(await policyLowMax.nextDelay(1, deliveryOutcome.RETRY_LIMITED)).toBe(1000);
      expect(await policyLowMax.nextDelay(2, deliveryOutcome.RETRY_LIMITED)).toBeNull();
    });

    it('should support default export and system defaults', async () => {
      expect(defaultFixedDelayRetryPolicy.strategy).toBe('FIXED');
      expect(defaultFixedDelayRetryPolicy.maxAttempts).toBe(8);
      expect(defaultFixedDelayRetryPolicy.delayMs).toBe(5000);

      const delay = await defaultFixedDelayRetryPolicy.nextDelay(1, deliveryOutcome.RETRY);
      expect(delay).toBe(5000);
    });
  });

  describe('Configurable ExponentialJitterRetryPolicy', () => {
    it('should calculate exponential backoff with custom base and multiplier', async () => {
      const policy = createExponentialJitterRetryPolicy({
        baseDelayMs: 1000,
        maxDelayMs: 60000,
        maxAttempts: 6,
        multiplier: 3.0,
      });

      expect(policy.strategy).toBe('EXPONENTIAL');
      expect(policy.baseDelayMs).toBe(1000);
      expect(policy.multiplier).toBe(3.0);

      const testRandom = randomGenerator.test(42);

      // Attempt 1: 1000 * 3^0 = 1000 max ceiling
      const delay1 = await policy.nextDelay(1, deliveryOutcome.RETRY, testRandom);
      expect(delay1).toBeGreaterThanOrEqual(0);
      expect(delay1).toBeLessThanOrEqual(1000);

      // Attempt 2: 1000 * 3^1 = 3000 max ceiling
      const delay2 = await policy.nextDelay(2, deliveryOutcome.RETRY, testRandom);
      expect(delay2).toBeGreaterThanOrEqual(0);
      expect(delay2).toBeLessThanOrEqual(3000);

      // Attempt 3: 1000 * 3^2 = 9000 max ceiling
      const delay3 = await policy.nextDelay(3, deliveryOutcome.RETRY, testRandom);
      expect(delay3).toBeGreaterThanOrEqual(0);
      expect(delay3).toBeLessThanOrEqual(9000);
    });

    it('should cap delay at custom maxDelayMs', async () => {
      const policy = createExponentialJitterRetryPolicy({
        baseDelayMs: 2000,
        maxDelayMs: 5000, // Small cap
        maxAttempts: 10,
        multiplier: 2.0,
      });

      const testRandom = randomGenerator.test(42);

      // At attempt 5, 2000 * 2^4 = 32000, but capped at 5000
      const delay = await policy.nextDelay(5, deliveryOutcome.RETRY, testRandom);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(5000);
    });

    it('should return null when custom maxAttempts exceeded', async () => {
      const policy = createExponentialJitterRetryPolicy({
        maxAttempts: 4,
      });

      expect(await policy.nextDelay(1, deliveryOutcome.RETRY)).not.toBeNull();
      expect(await policy.nextDelay(3, deliveryOutcome.RETRY)).not.toBeNull();
      expect(await policy.nextDelay(4, deliveryOutcome.RETRY)).toBeNull();
      expect(await policy.nextDelay(5, deliveryOutcome.RETRY)).toBeNull();
    });

    it('should return null for non-retryable outcomes', async () => {
      const policy = createExponentialJitterRetryPolicy({ maxAttempts: 5 });
      expect(await policy.nextDelay(1, deliveryOutcome.SUCCESS)).toBeNull();
      expect(await policy.nextDelay(1, deliveryOutcome.ENDPOINT_GONE)).toBeNull();
    });
  });

  describe('resolveRetryPolicy factory', () => {
    it('should return fixed policy for endpoint with retryStrategy FIXED', () => {
      const endpoint = {
        id: 'ep-1',
        retryStrategy: 'FIXED',
        retryMaxAttempts: 4,
        retryBaseDelayMs: 2500,
      };

      const policy = resolveRetryPolicy(endpoint);
      expect(policy.strategy).toBe('FIXED');
      expect(policy.maxAttempts).toBe(4);
      expect(policy.delayMs).toBe(2500);
    });

    it('should support snake_case properties for fixed policy', () => {
      const endpoint = {
        id: 'ep-1',
        retry_strategy: 'FIXED',
        retry_max_attempts: 6,
        retry_base_delay_ms: 1500,
      };

      const policy = resolveRetryPolicy(endpoint);
      expect(policy.strategy).toBe('FIXED');
      expect(policy.maxAttempts).toBe(6);
      expect(policy.delayMs).toBe(1500);
    });

    it('should return custom exponential policy when endpoint defines custom settings', () => {
      const endpoint = {
        id: 'ep-2',
        retryStrategy: 'EXPONENTIAL',
        retryMaxAttempts: 12,
        retryBaseDelayMs: 2000,
        retryMaxDelayMs: 600000,
        retryBackoffMultiplier: 2.5,
      };

      const policy = resolveRetryPolicy(endpoint);
      expect(policy.strategy).toBe('EXPONENTIAL');
      expect(policy.maxAttempts).toBe(12);
      expect(policy.baseDelayMs).toBe(2000);
      expect(policy.maxDelayMs).toBe(600000);
      expect(policy.multiplier).toBe(2.5);
    });

    it('should return default singleton when endpoint has no custom policy or is null', () => {
      expect(resolveRetryPolicy(null)).toBe(exponentialJitterRetryPolicy);
      expect(resolveRetryPolicy(undefined)).toBe(exponentialJitterRetryPolicy);

      const legacyEndpoint = {
        id: 'ep-legacy',
        url: 'https://example.com/webhook',
      };
      expect(resolveRetryPolicy(legacyEndpoint)).toBe(exponentialJitterRetryPolicy);
    });
  });

  describe('OutcomeHandler with Custom Retry Policies', () => {
    const mockDelivery = {
      id: 'del-custom-1',
      eventId: 'evt-1',
      endpointId: 'ep-custom-1',
      seq: 1,
      state: deliveryState.IN_FLIGHT,
      attemptCount: 0,
    };

    const mockAttempt = {
      startedAt: new Date().toISOString(),
      statusCode: 500,
      latencyMs: 150,
      error: 'Internal Server Error',
    };

    beforeEach(() => {
      vi.clearAllMocks();
      deliveryRepository.markTerminal.mockResolvedValue({
        id: 'del-custom-1',
        state: deliveryState.DEAD,
      });
      deliveryRepository.releaseLease.mockResolvedValue({
        id: 'del-custom-1',
        state: deliveryState.RETRYING,
      });
      thresholdCircuitBreaker.recordResult.mockResolvedValue(null);
    });

    it('should schedule retry with fixed delay when endpoint has FIXED strategy', async () => {
      const fixedEndpoint = {
        id: 'ep-custom-1',
        retryStrategy: 'FIXED',
        retryMaxAttempts: 4,
        retryBaseDelayMs: 3000,
        circuitState: circuitState.CLOSED,
        circuitUntil: null,
        consecutiveFailures: 0,
      };

      const result = await handleOutcome(
        mockDelivery,
        deliveryOutcome.RETRY,
        mockAttempt,
        fixedEndpoint
      );

      expect(result).not.toBeNull();
      expect(deliveryRepository.recordAttempt).toHaveBeenCalledWith(
        expect.objectContaining({ deliveryId: 'del-custom-1', attemptNo: 1 })
      );
      expect(deliveryRepository.releaseLease).toHaveBeenCalledWith(
        'del-custom-1',
        deliveryState.RETRYING,
        expect.any(String),
        'Internal Server Error',
        expect.objectContaining({ incrementAttempt: true, requireInFlight: true })
      );
    });

    it('should mark delivery as DEAD when endpoint maxAttempts is reached', async () => {
      const fixedEndpoint = {
        id: 'ep-custom-1',
        retryStrategy: 'FIXED',
        retryMaxAttempts: 2,
        retryBaseDelayMs: 2000,
        circuitState: circuitState.CLOSED,
        circuitUntil: null,
        consecutiveFailures: 0,
      };

      // Delivery with attemptCount = 1 (this next attempt will be attemptNo 2, meeting maxAttempts 2)
      const deliveryAttempt1 = { ...mockDelivery, attemptCount: 1 };

      await handleOutcome(
        deliveryAttempt1,
        deliveryOutcome.RETRY,
        mockAttempt,
        fixedEndpoint
      );

      expect(deliveryRepository.markTerminal).toHaveBeenCalledWith(
        'del-custom-1',
        deliveryState.DEAD,
        expect.objectContaining({ incrementAttempt: true, requireInFlight: true, expectedAttemptCount: 1 })
      );
      expect(deliveryRepository.releaseLease).not.toHaveBeenCalled();
    });

    it('should mark delivery as SUCCEEDED immediately without retry on 200 status', async () => {
      const fixedEndpoint = {
        id: 'ep-custom-1',
        retryStrategy: 'FIXED',
        retryMaxAttempts: 5,
        retryBaseDelayMs: 3000,
        circuitState: circuitState.CLOSED,
        circuitUntil: null,
        consecutiveFailures: 0,
      };

      deliveryRepository.markTerminal.mockResolvedValue({
        id: 'del-custom-1',
        state: deliveryState.SUCCEEDED,
      });

      const successAttempt = { ...mockAttempt, statusCode: 200, error: null };

      await handleOutcome(
        mockDelivery,
        deliveryOutcome.SUCCESS,
        successAttempt,
        fixedEndpoint
      );

      expect(deliveryRepository.markTerminal).toHaveBeenCalledWith(
        'del-custom-1',
        deliveryState.SUCCEEDED,
        expect.objectContaining({ incrementAttempt: true, requireInFlight: true })
      );
      expect(deliveryRepository.releaseLease).not.toHaveBeenCalled();
    });

    it('should mark delivery as DEAD immediately on 410 Gone (ENDPOINT_GONE)', async () => {
      const fixedEndpoint = {
        id: 'ep-custom-1',
        retryStrategy: 'FIXED',
        retryMaxAttempts: 5,
        retryBaseDelayMs: 3000,
        circuitState: circuitState.CLOSED,
        circuitUntil: null,
        consecutiveFailures: 0,
      };

      const goneAttempt = { ...mockAttempt, statusCode: 410, error: 'Endpoint Gone' };

      await handleOutcome(
        mockDelivery,
        deliveryOutcome.ENDPOINT_GONE,
        goneAttempt,
        fixedEndpoint
      );

      expect(deliveryRepository.markTerminal).toHaveBeenCalledWith(
        'del-custom-1',
        deliveryState.DEAD,
        expect.objectContaining({ incrementAttempt: true, requireInFlight: true })
      );
      expect(deliveryRepository.releaseLease).not.toHaveBeenCalled();
    });
  });
});
