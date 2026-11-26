/**
 * Comprehensive tests for CacheService.
 * Tests caching operations (get, set, del, delPattern, wrap), TTL behavior,
 * tenant-level invalidation, and graceful error fallback.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CacheService } from '../../src/services/cache/cacheService.js';

describe('CacheService', () => {
  let mockRedis;
  let cache;

  beforeEach(() => {
    mockRedis = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
      scan: vi.fn(),
    };
    cache = new CacheService({ redisClient: mockRedis });
  });

  describe('get and set', () => {
    it('returns null and increments misses when key does not exist', async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await cache.get('missing-key');
      expect(result).toBeNull();
      expect(mockRedis.get).toHaveBeenCalledWith('cache:missing-key');

      const stats = cache.getStats();
      expect(stats.misses).toBe(1);
      expect(stats.hits).toBe(0);
    });

    it('returns parsed JSON and increments hits when key exists', async () => {
      const data = { id: 'ep-123', url: 'https://example.com/webhook', active: true };
      mockRedis.get.mockResolvedValue(JSON.stringify(data));

      const result = await cache.get('endpoint:ep-123');
      expect(result).toEqual(data);
      expect(mockRedis.get).toHaveBeenCalledWith('cache:endpoint:ep-123');

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
    });

    it('sets value with EX TTL in Redis', async () => {
      mockRedis.set.mockResolvedValue('OK');
      const data = { count: 42 };

      const success = await cache.set('metrics:overview', data, 60);
      expect(success).toBe(true);
      expect(mockRedis.set).toHaveBeenCalledWith(
        'cache:metrics:overview',
        JSON.stringify(data),
        'EX',
        60
      );

      const stats = cache.getStats();
      expect(stats.sets).toBe(1);
    });
  });

  describe('del and delPattern', () => {
    it('deletes an individual key', async () => {
      mockRedis.del.mockResolvedValue(1);

      const success = await cache.del('endpoint:ep-123');
      expect(success).toBe(true);
      expect(mockRedis.del).toHaveBeenCalledWith('cache:endpoint:ep-123');

      const stats = cache.getStats();
      expect(stats.deletes).toBe(1);
    });

    it('scans and deletes keys matching pattern', async () => {
      mockRedis.scan
        .mockResolvedValueOnce(['cursor1', ['cache:tenant:t1:ep1', 'cache:tenant:t1:ep2']])
        .mockResolvedValueOnce(['0', ['cache:tenant:t1:list']]);
      mockRedis.del.mockResolvedValue(2);

      const count = await cache.delPattern('tenant:t1:*');
      expect(count).toBe(3);
      expect(mockRedis.scan).toHaveBeenCalledTimes(2);
      expect(mockRedis.del).toHaveBeenCalledWith('cache:tenant:t1:ep1', 'cache:tenant:t1:ep2');
      expect(mockRedis.del).toHaveBeenCalledWith('cache:tenant:t1:list');
    });

    it('invalidates all keys for a tenant via invalidateTenant', async () => {
      mockRedis.scan.mockResolvedValue(['0', ['cache:tenant:t-abc:data']]);
      mockRedis.del.mockResolvedValue(1);

      const count = await cache.invalidateTenant('t-abc');
      expect(count).toBe(1);
      expect(mockRedis.del).toHaveBeenCalledWith('cache:tenant:t-abc:data');
    });
  });

  describe('wrap (cache-aside pattern)', () => {
    it('returns cached data on cache hit without invoking fetchFn', async () => {
      const cachedData = { from: 'cache' };
      mockRedis.get.mockResolvedValue(JSON.stringify(cachedData));

      const fetchFn = vi.fn();
      const result = await cache.wrap('my-key', 300, fetchFn);

      expect(result).toEqual(cachedData);
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('calls fetchFn on cache miss, stores fresh data in cache, and returns it', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockRedis.set.mockResolvedValue('OK');

      const freshData = { from: 'database', time: Date.now() };
      const fetchFn = vi.fn().mockResolvedValue(freshData);

      const result = await cache.wrap('my-key', 300, fetchFn);

      expect(result).toEqual(freshData);
      expect(fetchFn).toHaveBeenCalled();
      expect(mockRedis.set).toHaveBeenCalledWith(
        'cache:my-key',
        JSON.stringify(freshData),
        'EX',
        300
      );
    });
  });

  describe('Graceful degradation on Redis errors', () => {
    it('returns null on get error without throwing', async () => {
      mockRedis.get.mockRejectedValue(new Error('Connection reset by peer'));

      const result = await cache.get('any-key');
      expect(result).toBeNull();

      const stats = cache.getStats();
      expect(stats.errors).toBe(1);
      expect(stats.misses).toBe(1);
    });

    it('returns false on set error without throwing', async () => {
      mockRedis.set.mockRejectedValue(new Error('OOM command not allowed when used memory > maxmemory'));

      const success = await cache.set('any-key', { a: 1 }, 100);
      expect(success).toBe(false);

      const stats = cache.getStats();
      expect(stats.errors).toBe(1);
    });

    it('returns 0 on delPattern error without throwing', async () => {
      mockRedis.scan.mockRejectedValue(new Error('Cluster down'));

      const count = await cache.delPattern('tenant:*');
      expect(count).toBe(0);

      const stats = cache.getStats();
      expect(stats.errors).toBe(1);
    });

    it('transparently runs fetchFn in wrap even if Redis is completely dead', async () => {
      mockRedis.get.mockRejectedValue(new Error('Redis connection refused'));
      mockRedis.set.mockRejectedValue(new Error('Redis connection refused'));

      const fetchFn = vi.fn().mockResolvedValue({ status: 'live-from-db' });
      const result = await cache.wrap('resilient-key', 60, fetchFn);

      expect(result).toEqual({ status: 'live-from-db' });
      expect(fetchFn).toHaveBeenCalled();
    });
  });
});
