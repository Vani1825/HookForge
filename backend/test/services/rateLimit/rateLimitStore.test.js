/**
 * Unit tests for RateLimitStore and MemoryRateLimitStore.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  RateLimitStore,
  MemoryRateLimitStore,
} from '../../../src/services/rateLimit/rateLimitStore.js';
import clock from '../../../src/utils/clock.js';

describe('RateLimitStore', () => {
  it('abstract RateLimitStore methods should throw if not implemented', async () => {
    const store = new RateLimitStore();
    await expect(store.consume('type', 'key', 10, 1000)).rejects.toThrow('must be implemented');
    await expect(store.get('type', 'key', 10, 1000)).rejects.toThrow('must be implemented');
    await expect(store.reset('type', 'key')).rejects.toThrow('must be implemented');
    expect(() => store.cleanup()).toThrow('must be implemented');
  });

  describe('MemoryRateLimitStore', () => {
    let testClock;
    let store;

    beforeEach(() => {
      testClock = clock.test(1000000);
      store = new MemoryRateLimitStore({ clock: testClock, cleanupIntervalMs: 0 });
    });

    afterEach(() => {
      store.destroy();
    });

    it('should allow requests within limit and track remaining permits', async () => {
      const res1 = await store.consume('tenant', 't1', 3, 1000);
      expect(res1.allowed).toBe(true);
      expect(res1.current).toBe(1);
      expect(res1.remaining).toBe(2);
      expect(res1.limit).toBe(3);

      const res2 = await store.consume('tenant', 't1', 3, 1000);
      expect(res2.allowed).toBe(true);
      expect(res2.current).toBe(2);
      expect(res2.remaining).toBe(1);

      const res3 = await store.consume('tenant', 't1', 3, 1000);
      expect(res3.allowed).toBe(true);
      expect(res3.current).toBe(3);
      expect(res3.remaining).toBe(0);

      // 4th request exceeds limit
      const res4 = await store.consume('tenant', 't1', 3, 1000);
      expect(res4.allowed).toBe(false);
      expect(res4.remaining).toBe(0);
      expect(res4.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    });

    it('should slide window forward as time advances', async () => {
      // Consume 3 permits at t=1000000
      await store.consume('ip', '1.1.1.1', 3, 1000);
      testClock.advanceTime(200); // t=1000200
      await store.consume('ip', '1.1.1.1', 3, 1000);
      testClock.advanceTime(200); // t=1000400
      await store.consume('ip', '1.1.1.1', 3, 1000);

      // Exceeded at t=1000400
      const blocked = await store.consume('ip', '1.1.1.1', 3, 1000);
      expect(blocked.allowed).toBe(false);

      // Advance time past the first permit's expiration (1000000 + 1000 = 1001000)
      testClock.advanceTime(601); // t=1001001 -> first permit has expired
      const allowedAgain = await store.consume('ip', '1.1.1.1', 3, 1000);
      expect(allowedAgain.allowed).toBe(true);
    });

    it('should isolate counters by limiter type and key', async () => {
      // Exhaust tenant A quota
      for (let i = 0; i < 5; i++) {
        await store.consume('tenant', 'tenant-a', 5, 1000);
      }
      const tenantABlocked = await store.consume('tenant', 'tenant-a', 5, 1000);
      expect(tenantABlocked.allowed).toBe(false);

      // Tenant B should still have full quota
      const tenantBAllowed = await store.consume('tenant', 'tenant-b', 5, 1000);
      expect(tenantBAllowed.allowed).toBe(true);
      expect(tenantBAllowed.remaining).toBe(4);

      // IP limiter with same ID should be completely isolated
      const ipAllowed = await store.consume('ip', 'tenant-a', 5, 1000);
      expect(ipAllowed.allowed).toBe(true);
    });

    it('should inspect status without consuming permits via get()', async () => {
      const initial = await store.get('test', 'k1', 2, 1000);
      expect(initial.allowed).toBe(true);
      expect(initial.current).toBe(0);
      expect(initial.remaining).toBe(2);

      await store.consume('test', 'k1', 2, 1000);
      await store.consume('test', 'k1', 2, 1000);

      const atLimit = await store.get('test', 'k1', 2, 1000);
      expect(atLimit.allowed).toBe(false);
      expect(atLimit.current).toBe(2);
      expect(atLimit.remaining).toBe(0);
      expect(atLimit.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    });

    it('should reset counters specifically or globally', async () => {
      await store.consume('auth', 'ip1', 5, 1000);
      await store.consume('auth', 'ip2', 5, 1000);
      await store.consume('tenant', 't1', 5, 1000);

      // Reset specific key
      await store.reset('auth', 'ip1');
      const ip1Status = await store.get('auth', 'ip1', 5, 1000);
      expect(ip1Status.current).toBe(0);
      const ip2Status = await store.get('auth', 'ip2', 5, 1000);
      expect(ip2Status.current).toBe(1);

      // Reset specific type
      await store.reset('auth');
      const ip2AfterReset = await store.get('auth', 'ip2', 5, 1000);
      expect(ip2AfterReset.current).toBe(0);
      const t1Status = await store.get('tenant', 't1', 5, 1000);
      expect(t1Status.current).toBe(1);

      // Reset all
      await store.reset();
      const t1AfterReset = await store.get('tenant', 't1', 5, 1000);
      expect(t1AfterReset.current).toBe(0);
    });

    it('should cleanup expired entries without removing active ones', async () => {
      // Entry 1: expires at t=1000000 + 500 = 1000500
      await store.consume('test', 'short-lived', 5, 500);
      // Entry 2: expires at t=1000000 + 5000 = 1005000
      await store.consume('test', 'long-lived', 5, 5000);

      expect(store.entries.size).toBe(2);

      // Advance clock past short-lived expiry but before long-lived
      testClock.advanceTime(1000); // t=1001000

      store.cleanup();

      // short-lived is pruned, long-lived remains active
      expect(store.entries.has('test:short-lived')).toBe(false);
      expect(store.entries.has('test:long-lived')).toBe(true);
      expect(store.entries.size).toBe(1);
    });

    it('should support automatic background cleanup timer', () => {
      vi.useFakeTimers();
      try {
        const autoStore = new MemoryRateLimitStore({ cleanupIntervalMs: 5000 });
        expect(autoStore.cleanupTimer).not.toBeNull();
        autoStore.destroy();
        expect(autoStore.cleanupTimer).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
