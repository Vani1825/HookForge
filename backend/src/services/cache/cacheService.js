/**
 * CacheService - Reusable Redis-backed caching service with tenant isolation.
 *
 * Implements cache-aside pattern with automatic JSON serialization, TTL enforcement,
 * pattern-based invalidation, and graceful error degradation.
 * If Redis is unavailable or unconfigured, all operations safely fall back to
 * cache misses / bypass, ensuring database queries always succeed.
 */

import { getRedisClient } from '../../config/redis.js';
import logger from '../../utils/logger.js';

export class CacheService {
  /**
   * @param {Object} [options]
   * @param {Object|Function} [options.redisClient] - Redis client or getter
   * @param {string} [options.prefix] - Cache key namespace prefix
   */
  constructor(options = {}) {
    this.clientProvider = options.redisClient || getRedisClient;
    this.prefix = options.prefix || 'cache:';
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      errors: 0,
    };
  }

  #getClient() {
    if (typeof this.clientProvider === 'function') {
      return this.clientProvider();
    }
    return this.clientProvider;
  }

  #toKey(key) {
    return `${this.prefix}${key}`;
  }

  /**
   * Retrieve cached value by key.
   *
   * @param {string} key
   * @returns {Promise<*|null>} Parsed cached value or null if miss or Redis error
   */
  async get(key) {
    const client = this.#getClient();
    if (!client) {
      this.stats.misses++;
      return null;
    }

    const fullKey = this.#toKey(key);
    try {
      const raw = await client.get(fullKey);
      if (raw === null || raw === undefined) {
        this.stats.misses++;
        logger.debug('Cache miss', { key });
        return null;
      }

      this.stats.hits++;
      logger.debug('Cache hit', { key });
      return JSON.parse(raw);
    } catch (err) {
      this.stats.errors++;
      this.stats.misses++;
      logger.warn('Redis cache get error; treating as miss', { key, error: err?.message });
      return null;
    }
  }

  /**
   * Store a value in cache with a TTL.
   *
   * @param {string} key
   * @param {*} value - Serializable data
   * @param {number} [ttlSeconds=300] - Expiration time in seconds
   * @returns {Promise<boolean>} True if cached, false if failed or disabled
   */
  async set(key, value, ttlSeconds = 300) {
    const client = this.#getClient();
    if (!client || value === undefined) {
      return false;
    }

    const fullKey = this.#toKey(key);
    try {
      const serialized = JSON.stringify(value);
      if (ttlSeconds && ttlSeconds > 0) {
        await client.set(fullKey, serialized, 'EX', ttlSeconds);
      } else {
        await client.set(fullKey, serialized);
      }
      this.stats.sets++;
      logger.debug('Cache set', { key, ttlSeconds });
      return true;
    } catch (err) {
      this.stats.errors++;
      logger.warn('Redis cache set error; skipping cache write', { key, error: err?.message });
      return false;
    }
  }

  /**
   * Delete an explicit key from cache.
   *
   * @param {string} key
   * @returns {Promise<boolean>}
   */
  async del(key) {
    const client = this.#getClient();
    if (!client) return false;

    const fullKey = this.#toKey(key);
    try {
      await client.del(fullKey);
      this.stats.deletes++;
      logger.debug('Cache deleted', { key });
      return true;
    } catch (err) {
      this.stats.errors++;
      logger.warn('Redis cache del error', { key, error: err?.message });
      return false;
    }
  }

  /**
   * Delete all keys matching a pattern (e.g. "tenant:xyz:endpoints*").
   *
   * @param {string} pattern
   * @returns {Promise<number>} Number of deleted keys
   */
  async delPattern(pattern) {
    const client = this.#getClient();
    if (!client) return 0;

    const fullPattern = this.#toKey(pattern);
    let deletedCount = 0;

    try {
      let cursor = '0';
      do {
        const [nextCursor, keys] = await client.scan(cursor, 'MATCH', fullPattern, 'COUNT', 100);
        cursor = nextCursor;
        if (keys && keys.length > 0) {
          await client.del(...keys);
          deletedCount += keys.length;
        }
      } while (cursor !== '0');

      this.stats.deletes += deletedCount;
      logger.debug('Cache pattern deleted', { pattern, deletedCount });
      return deletedCount;
    } catch (err) {
      this.stats.errors++;
      logger.warn('Redis cache delPattern error', { pattern, error: err?.message });
      return 0;
    }
  }

  /**
   * Cache-aside wrapper helper:
   * 1. Check cache for key.
   * 2. If hit, return cached value.
   * 3. If miss or Redis failure, call fetchFn(), cache non-null result, and return it.
   *
   * @param {string} key
   * @param {number} ttlSeconds
   * @param {Function} fetchFn - Async function returning fresh data
   * @returns {Promise<*>}
   */
  async wrap(key, ttlSeconds, fetchFn) {
    const cached = await this.get(key);
    if (cached !== null) {
      return cached;
    }

    const fresh = await fetchFn();
    if (fresh !== null && fresh !== undefined) {
      // Background cache write (do not block execution if set fails)
      this.set(key, fresh, ttlSeconds).catch(() => {});
    }
    return fresh;
  }

  /**
   * Invalidate all cached data for a specific tenant.
   *
   * @param {string} tenantId
   * @returns {Promise<number>}
   */
  async invalidateTenant(tenantId) {
    if (!tenantId) return 0;
    return this.delPattern(`tenant:${tenantId}:*`);
  }

  /**
   * Get internal hit/miss/error telemetry.
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * Reset stats.
   */
  resetStats() {
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      errors: 0,
    };
  }
}

// Singleton cache service
export const cacheService = new CacheService();

export default cacheService;
