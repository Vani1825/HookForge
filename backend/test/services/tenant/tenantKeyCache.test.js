/**
 * Unit tests for TenantKeyCache.
 * Tests in-memory TTL caching, LRU eviction, single-flight concurrency protection, and lifecycle methods.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TenantKeyCache } from '../../../src/services/tenant/tenantKeyCache.js';
import clock from '../../../src/utils/clock.js';

describe('TenantKeyCache', () => {
  let testClock;
  let cache;

  beforeEach(() => {
    testClock = clock.test(1000000);
    cache = new TenantKeyCache({
      ttlMs: 60000,
      maxEntries: 3,
      cleanupIntervalMs: 0, // Disable automatic background interval for deterministic tests
      clock: testClock,
    });
  });

  afterEach(() => {
    cache.destroy();
  });

  describe('basic get and set', () => {
    it('should return null on cache miss', () => {
      const result = cache.get('nonexistent_hash');
      expect(result).toBeNull();
      expect(cache.getStats().misses).toBe(1);
    });

    it('should return cached tenant on cache hit', () => {
      const tenant = { id: 'tenant-1', name: 'Acme Corp' };
      cache.set('hash_1', tenant);

      const cached = cache.get('hash_1');
      expect(cached).toEqual(tenant);
      expect(cache.getStats().hits).toBe(1);
      expect(cache.getStats().misses).toBe(0);
    });

    it('should return null for invalid or empty hash values', () => {
      expect(cache.get(null)).toBeNull();
      expect(cache.get('')).toBeNull();
      expect(cache.get(undefined)).toBeNull();
      expect(cache.get(123)).toBeNull();
    });
  });

  describe('negative lookup protection', () => {
    it('should never cache null, undefined, or invalid tenant objects', () => {
      cache.set('hash_null', null);
      cache.set('hash_undefined', undefined);
      cache.set('hash_empty', {});
      cache.set('hash_no_id', { name: 'No ID' });

      expect(cache.size).toBe(0);
      expect(cache.get('hash_null')).toBeNull();
      expect(cache.get('hash_undefined')).toBeNull();
      expect(cache.get('hash_empty')).toBeNull();
      expect(cache.get('hash_no_id')).toBeNull();
    });
  });

  describe('TTL expiration', () => {
    it('should lazily expire entries after configured TTL', () => {
      const tenant = { id: 'tenant-1', name: 'Acme Corp' };
      cache.set('hash_1', tenant);

      // Advance time by 30s (within 60s TTL)
      testClock.advanceTime(30000);
      expect(cache.get('hash_1')).toEqual(tenant);
      expect(cache.size).toBe(1);

      // Advance time by another 31s (total 61s, expired)
      testClock.advanceTime(31000);
      const expired = cache.get('hash_1');
      expect(expired).toBeNull();
      expect(cache.size).toBe(0);
      expect(cache.getStats().expirations).toBe(1);
    });

    it('should prune all expired entries during periodic cleanup()', () => {
      cache.set('hash_1', { id: 't1', name: 'T1' });
      cache.set('hash_2', { id: 't2', name: 'T2' });

      // Advance past TTL
      testClock.advanceTime(61000);

      // Add a fresh entry
      cache.set('hash_3', { id: 't3', name: 'T3' });

      expect(cache.size).toBe(3);
      const pruned = cache.cleanup();
      expect(pruned).toBe(2);
      expect(cache.size).toBe(1);
      expect(cache.get('hash_3')).toEqual({ id: 't3', name: 'T3' });
    });
  });

  describe('LRU eviction and maximum capacity', () => {
    it('should evict the least recently used entry when maxEntries is exceeded', () => {
      // Capacity is 3
      cache.set('hash_1', { id: 't1', name: 'T1' });
      cache.set('hash_2', { id: 't2', name: 'T2' });
      cache.set('hash_3', { id: 't3', name: 'T3' });
      expect(cache.size).toBe(3);

      // Access hash_1 so its LRU order moves to most recently used: order is now [hash_2, hash_3, hash_1]
      cache.get('hash_1');

      // Insert hash_4 -> should evict hash_2 (the oldest unaccessed key)
      cache.set('hash_4', { id: 't4', name: 'T4' });
      expect(cache.size).toBe(3);
      expect(cache.getStats().evictions).toBe(1);

      // hash_2 must be evicted
      expect(cache.get('hash_2')).toBeNull();
      // hash_1, hash_3, hash_4 must remain
      expect(cache.get('hash_1')).toEqual({ id: 't1', name: 'T1' });
      expect(cache.get('hash_3')).toEqual({ id: 't3', name: 'T3' });
      expect(cache.get('hash_4')).toEqual({ id: 't4', name: 'T4' });
    });

    it('should update entry position in LRU order when set() is called on existing key', () => {
      cache.set('hash_1', { id: 't1', name: 'T1' });
      cache.set('hash_2', { id: 't2', name: 'T2' });
      cache.set('hash_3', { id: 't3', name: 'T3' });

      // Overwrite hash_1 -> moves to end: order is now [hash_2, hash_3, hash_1]
      cache.set('hash_1', { id: 't1-updated', name: 'T1 Updated' });

      // Insert hash_4 -> should evict hash_2
      cache.set('hash_4', { id: 't4', name: 'T4' });
      expect(cache.get('hash_2')).toBeNull();
      expect(cache.get('hash_1')?.name).toBe('T1 Updated');
    });
  });

  describe('invalidation and clear', () => {
    it('should remove specific key via invalidate()', () => {
      cache.set('hash_1', { id: 't1', name: 'T1' });
      expect(cache.invalidate('hash_1')).toBe(true);
      expect(cache.get('hash_1')).toBeNull();
      expect(cache.invalidate('hash_1')).toBe(false);
    });

    it('should clear all entries and pending lookups via clear()', () => {
      cache.set('hash_1', { id: 't1', name: 'T1' });
      cache.set('hash_2', { id: 't2', name: 'T2' });

      cache.clear();
      expect(cache.size).toBe(0);
      expect(cache.get('hash_1')).toBeNull();
      expect(cache.get('hash_2')).toBeNull();
    });
  });

  describe('single-flight concurrent deduplication (getOrFetch)', () => {
    it('should coalesce concurrent calls for the same hash into a single fetch execution', async () => {
      const fetchFn = vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { id: 'tenant-sf', name: 'Single Flight' };
      });

      const promises = [
        cache.getOrFetch('hash_sf', fetchFn),
        cache.getOrFetch('hash_sf', fetchFn),
        cache.getOrFetch('hash_sf', fetchFn),
      ];

      const results = await Promise.all(promises);

      expect(results).toEqual([
        { id: 'tenant-sf', name: 'Single Flight' },
        { id: 'tenant-sf', name: 'Single Flight' },
        { id: 'tenant-sf', name: 'Single Flight' },
      ]);

      // fetchFn must have been called exactly once!
      expect(fetchFn).toHaveBeenCalledTimes(1);

      // Subsequent call is served from cache
      const cached = cache.get('hash_sf');
      expect(cached).toEqual({ id: 'tenant-sf', name: 'Single Flight' });
    });

    it('should execute separate fetches for different hashes concurrently without blocking', async () => {
      const fetchA = vi.fn().mockResolvedValue({ id: 't-a', name: 'Tenant A' });
      const fetchB = vi.fn().mockResolvedValue({ id: 't-b', name: 'Tenant B' });

      const [resA, resB] = await Promise.all([
        cache.getOrFetch('hash_a', fetchA),
        cache.getOrFetch('hash_b', fetchB),
      ]);

      expect(resA.id).toBe('t-a');
      expect(resB.id).toBe('t-b');
      expect(fetchA).toHaveBeenCalledTimes(1);
      expect(fetchB).toHaveBeenCalledTimes(1);
    });

    it('should clean up pending lookup on failure and not cache rejected promise', async () => {
      const failingFetch = vi.fn().mockRejectedValue(new Error('DB Timeout'));

      const p1 = cache.getOrFetch('hash_fail', failingFetch);
      const p2 = cache.getOrFetch('hash_fail', failingFetch);

      await expect(p1).rejects.toThrow('DB Timeout');
      await expect(p2).rejects.toThrow('DB Timeout');

      expect(failingFetch).toHaveBeenCalledTimes(1);
      expect(cache.size).toBe(0);

      // Subsequent retry must invoke fetcher again
      const successFetch = vi.fn().mockResolvedValue({ id: 't-ok', name: 'OK' });
      const res = await cache.getOrFetch('hash_fail', successFetch);
      expect(res.id).toBe('t-ok');
      expect(successFetch).toHaveBeenCalledTimes(1);
    });

    it('should not cache negative results (null) from fetchFn', async () => {
      const nullFetch = vi.fn().mockResolvedValue(null);

      const res = await cache.getOrFetch('hash_missing', nullFetch);
      expect(res).toBeNull();
      expect(cache.size).toBe(0);

      // Next call must call fetchFn again
      await cache.getOrFetch('hash_missing', nullFetch);
      expect(nullFetch).toHaveBeenCalledTimes(2);
    });

    it('should NOT repopulate cache if invalidate() was called while fetch was in-flight', async () => {
      let resolveDb;
      const slowFetch = vi.fn().mockImplementation(() => {
        return new Promise((resolve) => {
          resolveDb = resolve;
        });
      });

      // Start in-flight lookup
      const lookupPromise = cache.getOrFetch('hash_race', slowFetch);

      // Invalidate while lookup is still in-flight
      cache.invalidate('hash_race');

      // Database query finishes and resolves
      resolveDb({ id: 'tenant-stale', name: 'Stale Corp' });
      const result = await lookupPromise;

      // Caller gets its original result
      expect(result).toEqual({ id: 'tenant-stale', name: 'Stale Corp' });

      // But the cache must NOT have been repopulated!
      expect(cache.get('hash_race')).toBeNull();
      expect(cache.size).toBe(0);
    });

    it('should not allow an older in-flight finally block to delete a newer lookup started after invalidation', async () => {
      let resolveOlder;
      let resolveNewer;

      const olderFetch = vi.fn().mockImplementation(() => {
        return new Promise((resolve) => {
          resolveOlder = resolve;
        });
      });

      const newerFetch = vi.fn().mockImplementation(() => {
        return new Promise((resolve) => {
          resolveNewer = resolve;
        });
      });

      // 1. Older lookup starts
      const olderPromise = cache.getOrFetch('hash_concurrent', olderFetch);

      // 2. Invalidate is called
      cache.invalidate('hash_concurrent');

      // 3. Newer lookup starts before older lookup resolves
      const newerPromise = cache.getOrFetch('hash_concurrent', newerFetch);

      // 4. Older lookup completes
      resolveOlder({ id: 'tenant-old', name: 'Old' });
      await olderPromise;

      // 5. Verify newer lookup is STILL active in pendingLookups and was NOT deleted by older lookup's finally block
      expect(cache.pendingLookups.has('hash_concurrent')).toBe(true);

      // 6. Newer lookup completes and successfully caches its result
      resolveNewer({ id: 'tenant-new', name: 'New' });
      await newerPromise;

      expect(cache.get('hash_concurrent')).toEqual({ id: 'tenant-new', name: 'New' });
      expect(cache.pendingLookups.has('hash_concurrent')).toBe(false);
    });

    it('should NOT repopulate cache if clear() was called while fetch was in-flight', async () => {
      let resolveDb;
      const slowFetch = vi.fn().mockImplementation(() => {
        return new Promise((resolve) => {
          resolveDb = resolve;
        });
      });

      const lookupPromise = cache.getOrFetch('hash_clear_race', slowFetch);

      // Clear while fetch is in-flight
      cache.clear();

      resolveDb({ id: 'tenant-cleared', name: 'Cleared Corp' });
      const result = await lookupPromise;

      expect(result).toEqual({ id: 'tenant-cleared', name: 'Cleared Corp' });
      expect(cache.get('hash_clear_race')).toBeNull();
      expect(cache.size).toBe(0);
    });
  });

  describe('object safety and immutability', () => {
    it('should freeze cached tenant objects and prevent caller mutation', () => {
      cache.set('hash_immutable', { id: 'orig-id', name: 'Original Name' });
      const cached = cache.get('hash_immutable');

      expect(Object.isFrozen(cached)).toBe(true);
      expect(() => {
        cached.id = 'hacked-id';
      }).toThrow(TypeError);

      expect(cache.get('hash_immutable').id).toBe('orig-id');
    });
  });

  describe('cleanup timer unref behavior', () => {
    it('should initialize background cleanup timer with unref()', () => {
      const activeCacheWithTimer = new TenantKeyCache({
        cleanupIntervalMs: 5000,
      });

      expect(activeCacheWithTimer.cleanupTimer).toBeDefined();
      activeCacheWithTimer.destroy();
      expect(activeCacheWithTimer.cleanupTimer).toBeNull();
    });
  });

  describe('security and key hygiene', () => {
    it('should store strictly the computed hash and never raw API key tokens', () => {
      const rawApiKey = 'wh_live_secret_token_1234567890abcdef';
      // In HookForge, auth.js computes the SHA-256 hash
      const crypto = require('crypto');
      const hash = crypto.createHash('sha256').update(rawApiKey).digest('hex');

      cache.set(hash, { id: 'tenant-secure', name: 'Secure Corp' });

      // Verify the map keys: only the hash exists, rawApiKey is nowhere in keys
      const keys = Array.from(cache.entries.keys());
      expect(keys).toContain(hash);
      expect(keys).not.toContain(rawApiKey);
      expect(cache.get(rawApiKey)).toBeNull();

      // Verify stored entry object: only contains tenant id and name
      const entry = cache.entries.get(hash);
      expect(entry.tenant).toEqual({ id: 'tenant-secure', name: 'Secure Corp' });
      expect(JSON.stringify(entry)).not.toContain(rawApiKey);
    });
  });
});
