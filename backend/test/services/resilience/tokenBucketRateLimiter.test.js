/**
 * Tests for TokenBucketRateLimiter.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tryAcquire, clear } from '../../../src/services/resilience/tokenBucketRateLimiter.js';
import clock from '../../../src/utils/clock.js';

describe('TokenBucketRateLimiter', () => {
  afterEach(() => {
    clear();
  });

  describe('tryAcquire', () => {
    it('should allow first request for new endpoint', async () => {
      const allowed = await tryAcquire('endpoint-1', 10);
      expect(allowed).toBe(true);
    });

    it('should allow requests up to rate limit', async () => {
      const endpointId = 'endpoint-1';
      const rateLimit = 5;

      // Should allow 5 requests in burst
      for (let i = 0; i < 5; i++) {
        const allowed = await tryAcquire(endpointId, rateLimit);
        expect(allowed).toBe(true);
      }

      // 6th request should be denied
      const allowed = await tryAcquire(endpointId, rateLimit);
      expect(allowed).toBe(false);
    });

    it('should refill tokens over time', async () => {
      const endpointId = 'endpoint-1';
      const rateLimit = 10;
      const testClock = clock.test(Date.now());

      // Exhaust the bucket
      for (let i = 0; i < 10; i++) {
        await tryAcquire(endpointId, rateLimit, testClock);
      }

      // Should be denied
      let allowed = await tryAcquire(endpointId, rateLimit, testClock);
      expect(allowed).toBe(false);

      // Advance time by 1 second (should refill 10 tokens)
      testClock.advanceTime(1000);

      // Should be allowed again
      allowed = await tryAcquire(endpointId, rateLimit, testClock);
      expect(allowed).toBe(true);
    });

    it('should handle multiple endpoints independently', async () => {
      const endpoint1 = 'endpoint-1';
      const endpoint2 = 'endpoint-2';
      const rateLimit = 2;

      // Exhaust endpoint1
      await tryAcquire(endpoint1, rateLimit);
      await tryAcquire(endpoint1, rateLimit);
      let allowed = await tryAcquire(endpoint1, rateLimit);
      expect(allowed).toBe(false);

      // endpoint2 should still have tokens
      allowed = await tryAcquire(endpoint2, rateLimit);
      expect(allowed).toBe(true);
    });

    it('should allow fractional token refill', async () => {
      const endpointId = 'endpoint-1';
      const rateLimit = 10;
      const testClock = clock.test(Date.now());

      // Exhaust the bucket
      for (let i = 0; i < 10; i++) {
        await tryAcquire(endpointId, rateLimit, testClock);
      }

      // Advance time by 0.5 seconds (should refill 5 tokens)
      testClock.advanceTime(500);

      // Should allow 5 requests
      for (let i = 0; i < 5; i++) {
        const allowed = await tryAcquire(endpointId, rateLimit, testClock);
        expect(allowed).toBe(true);
      }

      // 6th should be denied
      const allowed = await tryAcquire(endpointId, rateLimit, testClock);
      expect(allowed).toBe(false);
    });

    it('should not exceed capacity after refill', async () => {
      const endpointId = 'endpoint-1';
      const rateLimit = 10;
      const testClock = clock.test(Date.now());

      // Use 1 token
      await tryAcquire(endpointId, rateLimit, testClock);

      // Advance time by 10 seconds (would refill 100 tokens, but cap at 10)
      testClock.advanceTime(10000);

      // Should still only allow 10 requests (burst capacity)
      for (let i = 0; i < 10; i++) {
        const allowed = await tryAcquire(endpointId, rateLimit, testClock);
        expect(allowed).toBe(true);
      }

      const allowed = await tryAcquire(endpointId, rateLimit, testClock);
      expect(allowed).toBe(false);
    });
  });
});
