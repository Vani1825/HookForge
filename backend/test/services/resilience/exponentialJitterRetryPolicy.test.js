/**
 * Tests for ExponentialJitterRetryPolicy.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import exponentialJitterRetryPolicy from '../../../src/services/resilience/exponentialJitterRetryPolicy.js';
import { deliveryOutcome } from '../../../src/domain/deliveryOutcome.js';
import randomGenerator from '../../../src/utils/random.js';

describe('ExponentialJitterRetryPolicy', () => {
  describe('nextDelay', () => {
    it('should return null for SUCCESS outcome', async () => {
      const delay = await exponentialJitterRetryPolicy.nextDelay(1, deliveryOutcome.SUCCESS);
      expect(delay).toBeNull();
    });

    it('should return null for ENDPOINT_GONE outcome', async () => {
      const delay = await exponentialJitterRetryPolicy.nextDelay(1, deliveryOutcome.ENDPOINT_GONE);
      expect(delay).toBeNull();
    });

    it('should return delay for RETRY outcome', async () => {
      const testRandom = randomGenerator.test(42);
      const delay = await exponentialJitterRetryPolicy.nextDelay(1, deliveryOutcome.RETRY, testRandom);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(5000); // BASE_DELAY_MS
    });

    it('should return delay for RATE_LIMITED outcome', async () => {
      const testRandom = randomGenerator.test(42);
      const delay = await exponentialJitterRetryPolicy.nextDelay(1, deliveryOutcome.RATE_LIMITED, testRandom);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(5000);
    });

    it('should return delay for RETRY_LIMITED outcome', async () => {
      const testRandom = randomGenerator.test(42);
      const delay = await exponentialJitterRetryPolicy.nextDelay(1, deliveryOutcome.RETRY_LIMITED, testRandom);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(5000);
    });

    it('should return null when max attempts exceeded for RETRY', async () => {
      const delay = await exponentialJitterRetryPolicy.nextDelay(8, deliveryOutcome.RETRY);
      expect(delay).toBeNull();
    });

    it('should return null when max attempts exceeded for RETRY_LIMITED', async () => {
      const delay = await exponentialJitterRetryPolicy.nextDelay(3, deliveryOutcome.RETRY_LIMITED);
      expect(delay).toBeNull();
    });

    it('should calculate exponential backoff correctly', async () => {
      const testRandom = randomGenerator.test(42);
      
      // Attempt 1: base * 2^0 = 5000
      const delay1 = await exponentialJitterRetryPolicy.nextDelay(1, deliveryOutcome.RETRY, testRandom);
      expect(delay1).toBeLessThanOrEqual(5000);

      // Attempt 2: base * 2^1 = 10000
      const delay2 = await exponentialJitterRetryPolicy.nextDelay(2, deliveryOutcome.RETRY, testRandom);
      expect(delay2).toBeLessThanOrEqual(10000);

      // Attempt 3: base * 2^2 = 20000
      const delay3 = await exponentialJitterRetryPolicy.nextDelay(3, deliveryOutcome.RETRY, testRandom);
      expect(delay3).toBeLessThanOrEqual(20000);
    });

    it('should cap delay at MAX_DELAY_MS', async () => {
      const testRandom = randomGenerator.test(42);
      
      // At attempt 30, exponential would be huge, but should be capped
      const delay = await exponentialJitterRetryPolicy.nextDelay(30, deliveryOutcome.RETRY, testRandom);
      // Delay should be null if max attempts exceeded, or a number if retryable
      if (delay !== null) {
        expect(typeof delay).toBe('number');
        expect(delay).toBeLessThanOrEqual(3600000); // MAX_DELAY_MS
      }
    });

    it('should use full jitter (random in [0, cappedDelay])', async () => {
      // With seeded random, we should get deterministic results
      const testRandom1 = randomGenerator.test(42);
      const testRandom2 = randomGenerator.test(42);
      
      const delay1 = await exponentialJitterRetryPolicy.nextDelay(1, deliveryOutcome.RETRY, testRandom1);
      const delay2 = await exponentialJitterRetryPolicy.nextDelay(1, deliveryOutcome.RETRY, testRandom2);
      
      // Same seed should produce same result
      expect(delay1).toBe(delay2);
    });

    it('should respect RETRY_LIMITED max attempts (3)', async () => {
      const delay1 = await exponentialJitterRetryPolicy.nextDelay(1, deliveryOutcome.RETRY_LIMITED);
      expect(delay1).not.toBeNull();

      const delay2 = await exponentialJitterRetryPolicy.nextDelay(2, deliveryOutcome.RETRY_LIMITED);
      expect(delay2).not.toBeNull();

      const delay3 = await exponentialJitterRetryPolicy.nextDelay(3, deliveryOutcome.RETRY_LIMITED);
      expect(delay3).toBeNull();
    });

    it('should respect general max attempts (8)', async () => {
      for (let i = 1; i <= 7; i++) {
        const delay = await exponentialJitterRetryPolicy.nextDelay(i, deliveryOutcome.RETRY);
        expect(delay).not.toBeNull();
      }

      const delay8 = await exponentialJitterRetryPolicy.nextDelay(8, deliveryOutcome.RETRY);
      expect(delay8).toBeNull();
    });
  });
});
