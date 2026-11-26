/**
 * Comprehensive tests for RedisRateLimitStore.
 * Tests sliding-window enforcement, atomic Lua script execution,
 * remaining permits, reset functionality, and seamless fallback to MemoryRateLimitStore.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RedisRateLimitStore } from '../../src/services/rateLimit/redisRateLimitStore.js';
import { MemoryRateLimitStore, DelegatingRateLimitStore } from '../../src/services/rateLimit/rateLimitStore.js';

describe('RedisRateLimitStore', () => {
  let mockClock;
  let currentTime;

  beforeEach(() => {
    currentTime = 1000000;
    mockClock = {
      now: vi.fn(() => currentTime),
    };
  });

  describe('Permit consumption via atomic Lua script', () => {
    it('consumes permits up to the limit and returns rate limit headers data', async () => {
      // Mock Redis client with simulated Lua script return values
      const mockRedis = {
        eval: vi.fn()
          // 1st request: allowed=1, current=1, remaining=2, resetMs=1000
          .mockResolvedValueOnce([1, 1, 2, 1000])
          // 2nd request: allowed=1, current=2, remaining=1, resetMs=900
          .mockResolvedValueOnce([1, 2, 1, 900])
          // 3rd request: allowed=1, current=3, remaining=0, resetMs=800
          .mockResolvedValueOnce([1, 3, 0, 800]),
      };

      const store = new RedisRateLimitStore({
        redisClient: mockRedis,
        clock: mockClock,
      });

      const res1 = await store.consume('tenant', 'tenant-123', 3, 1000);
      expect(res1.allowed).toBe(true);
      expect(res1.current).toBe(1);
      expect(res1.remaining).toBe(2);
      expect(res1.retryAfterSeconds).toBe(1);

      const res2 = await store.consume('tenant', 'tenant-123', 3, 1000);
      expect(res2.allowed).toBe(true);
      expect(res2.current).toBe(2);
      expect(res2.remaining).toBe(1);

      const res3 = await store.consume('tenant', 'tenant-123', 3, 1000);
      expect(res3.allowed).toBe(true);
      expect(res3.current).toBe(3);
      expect(res3.remaining).toBe(0);

      expect(mockRedis.eval).toHaveBeenCalledTimes(3);
    });

    it('rejects requests when rate limit is exceeded', async () => {
      const mockRedis = {
        eval: vi.fn().mockResolvedValue([0, 5, 0, 1500]), // allowed=0, current=5, remaining=0, resetMs=1500
      };

      const store = new RedisRateLimitStore({
        redisClient: mockRedis,
        clock: mockClock,
      });

      const res = await store.consume('tenant', 'tenant-123', 5, 1000);
      expect(res.allowed).toBe(false);
      expect(res.current).toBe(5);
      expect(res.remaining).toBe(0);
      expect(res.resetMs).toBe(1500);
      expect(res.retryAfterSeconds).toBe(2); // Math.ceil(1500 / 1000)
    });

    it('inspects rate limit status with get() without consuming a permit', async () => {
      const mockRedis = {
        eval: vi.fn().mockResolvedValue([1, 2, 8, 500]),
      };

      const store = new RedisRateLimitStore({
        redisClient: mockRedis,
        clock: mockClock,
      });

      const res = await store.get('auth_fail', '192.168.1.1', 10, 60000);
      expect(res.allowed).toBe(true);
      expect(res.current).toBe(2);
      expect(res.remaining).toBe(8);
      expect(res.resetMs).toBe(500);
      expect(res.retryAfterSeconds).toBe(1);
    });
  });

  describe('Reset and Cleanup', () => {
    it('deletes keys for a specific type and key', async () => {
      const mockRedis = {
        del: vi.fn().mockResolvedValue(2),
      };

      const store = new RedisRateLimitStore({
        redisClient: mockRedis,
        clock: mockClock,
      });

      await store.reset('tenant', 'tenant-xyz');
      expect(mockRedis.del).toHaveBeenCalledWith(
        'ratelimit:tenant:tenant-xyz',
        'ratelimit:tenant:tenant-xyz:seq'
      );
    });

    it('scans and deletes keys for a specific type prefix', async () => {
      const mockRedis = {
        scan: vi.fn()
          .mockResolvedValueOnce(['42', ['ratelimit:tenant:t1', 'ratelimit:tenant:t2']])
          .mockResolvedValueOnce(['0', ['ratelimit:tenant:t3']]),
        del: vi.fn().mockResolvedValue(1),
      };

      const store = new RedisRateLimitStore({
        redisClient: mockRedis,
        clock: mockClock,
      });

      await store.reset('tenant');
      expect(mockRedis.scan).toHaveBeenCalled();
      expect(mockRedis.del).toHaveBeenCalledWith('ratelimit:tenant:t1', 'ratelimit:tenant:t2');
      expect(mockRedis.del).toHaveBeenCalledWith('ratelimit:tenant:t3');
    });
  });

  describe('Graceful Fallback to MemoryRateLimitStore', () => {
    it('transparently falls back to in-memory store when Redis client is null', async () => {
      const fallbackMemory = new MemoryRateLimitStore({ clock: mockClock });
      const store = new RedisRateLimitStore({
        redisClient: null,
        fallbackStore: fallbackMemory,
        clock: mockClock,
      });

      // Consume permit using in-memory store
      const res1 = await store.consume('tenant', 'tenant-abc', 2, 1000);
      expect(res1.allowed).toBe(true);
      expect(res1.current).toBe(1);

      const res2 = await store.consume('tenant', 'tenant-abc', 2, 1000);
      expect(res2.allowed).toBe(true);
      expect(res2.current).toBe(2);

      const res3 = await store.consume('tenant', 'tenant-abc', 2, 1000);
      expect(res3.allowed).toBe(false);
    });

    it('transparently falls back to in-memory store when Redis throws an unexpected error', async () => {
      const fallbackMemory = new MemoryRateLimitStore({ clock: mockClock });
      const mockRedis = {
        eval: vi.fn().mockRejectedValue(new Error('READONLY You cannot write against a read only replica.')),
      };

      const store = new RedisRateLimitStore({
        redisClient: mockRedis,
        fallbackStore: fallbackMemory,
        clock: mockClock,
      });

      // Should not throw, should log warning and return permit from in-memory fallback
      const res = await store.consume('tenant', 'tenant-fallback', 10, 1000);
      expect(res.allowed).toBe(true);
      expect(res.current).toBe(1);
    });
  });

  describe('DelegatingRateLimitStore Integration', () => {
    it('correctly handles consume and get through delegating singleton', async () => {
      const delegatingStore = new DelegatingRateLimitStore();

      const res = await delegatingStore.consume('test_type', 'test_key', 5, 1000);
      expect(res).toBeDefined();
      expect(res.allowed).toBe(true);
      expect(res.current).toBe(1);

      const status = await delegatingStore.get('test_type', 'test_key', 5, 1000);
      expect(status.allowed).toBe(true);
      expect(status.current).toBe(1);

      await delegatingStore.reset('test_type', 'test_key');
      const resetStatus = await delegatingStore.get('test_type', 'test_key', 5, 1000);
      expect(resetStatus.current).toBe(0);

      delegatingStore.destroy();
    });
  });
});
