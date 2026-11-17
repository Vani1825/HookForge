/**
 * Rate limit store abstraction and in-memory sliding-window implementation.
 *
 * ARCHITECTURAL NOTE & PROCESS-LOCAL LIMITATION:
 * The MemoryRateLimitStore implemented below stores counters in Node.js process memory.
 * It is suitable for single-instance HookForge deployments (e.g. local Docker development).
 * In-memory counters are strictly process-local; in a horizontally scaled multi-replica
 * deployment, each replica maintains its own isolated counters, leading to inconsistent
 * global rate limits.
 *
 * For clustered or multi-replica production deployments, a distributed store implementation
 * (such as RedisRateLimitStore using Redis sorted sets or token bucket Lua scripts) should
 * be plugged into this RateLimitStore abstraction without altering middleware code.
 */

import clock from '../../utils/clock.js';

/**
 * Abstract RateLimitStore interface.
 * Storage implementations must implement consume(), get(), reset(), and cleanup().
 */
export class RateLimitStore {
  /**
   * Consume a permit for the given key in the specified window.
   *
   * @param {string} type - Limiter namespace (e.g. 'auth_fail', 'tenant', 'health')
   * @param {string} key - Identifier (e.g. IP address or tenantId)
   * @param {number} limit - Maximum allowed requests in the window
   * @param {number} windowMs - Window duration in milliseconds
   * @returns {Promise<{ allowed: boolean, current: number, limit: number, remaining: number, resetMs: number, retryAfterSeconds: number }>}
   */
  async consume(_type, _key, _limit, _windowMs) {
    throw new Error('RateLimitStore.consume must be implemented by subclass');
  }

  /**
   * Inspect current rate limit status without consuming a permit.
   *
   * @param {string} type - Limiter namespace
   * @param {string} key - Identifier
   * @param {number} limit - Maximum allowed requests in the window
   * @param {number} windowMs - Window duration in milliseconds
   * @returns {Promise<{ allowed: boolean, current: number, limit: number, remaining: number, resetMs: number, retryAfterSeconds: number }>}
   */
  async get(_type, _key, _limit, _windowMs) {
    throw new Error('RateLimitStore.get must be implemented by subclass');
  }

  /**
   * Reset / clear counters.
   * @param {string} [type] - Optional limiter namespace
   * @param {string} [key] - Optional identifier
   */
  async reset(_type, _key) {
    throw new Error('RateLimitStore.reset must be implemented by subclass');
  }

  /**
   * Prune expired entries to prevent unbounded memory growth.
   */
  cleanup() {
    throw new Error('RateLimitStore.cleanup must be implemented by subclass');
  }
}

/**
 * In-Memory Sliding-Window Rate Limit Store.
 *
 * Tracks individual request timestamps per `${type}:${key}` within a sliding time window.
 * Ensures smooth rate limiting without fixed-window boundary spikes.
 * Periodically prunes expired entries to avoid memory leaks.
 */
export class MemoryRateLimitStore extends RateLimitStore {
  /**
   * @param {Object} [options]
   * @param {Object} [options.clock] - Clock instance for deterministic time (defaults to clock.system)
   * @param {number} [options.cleanupIntervalMs] - Interval to prune expired keys (defaults to 60000ms, 0 disables timer)
   */
  constructor({ clock: clockSource = clock.system, cleanupIntervalMs = 60000 } = {}) {
    super();
    this.clock = clockSource;
    this.entries = new Map();

    if (cleanupIntervalMs > 0) {
      this.cleanupTimer = setInterval(() => {
        this.cleanup();
      }, cleanupIntervalMs);
      if (this.cleanupTimer.unref) {
        this.cleanupTimer.unref();
      }
    } else {
      this.cleanupTimer = null;
    }
  }

  /**
   * Construct compound key to ensure complete counter isolation across limiter types and keys.
   */
  #toFullKey(type, key) {
    return `${type}:${key}`;
  }

  /**
   * Consume a permit for the given key in the specified window.
   */
  async consume(type, key, limit, windowMs) {
    const fullKey = this.#toFullKey(type, key);
    const now = this.clock.now();
    let entry = this.entries.get(fullKey);

    if (!entry) {
      entry = {
        timestamps: [now],
        lastAccess: now,
        expiresAt: now + windowMs,
      };
      this.entries.set(fullKey, entry);
      return {
        allowed: true,
        current: 1,
        limit,
        remaining: Math.max(0, limit - 1),
        resetMs: windowMs,
        retryAfterSeconds: Math.max(1, Math.ceil(windowMs / 1000)),
      };
    }

    // Filter out timestamps older than the sliding window
    const windowStart = now - windowMs;
    entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);
    entry.lastAccess = now;
    entry.expiresAt = now + windowMs;

    if (entry.timestamps.length < limit) {
      entry.timestamps.push(now);
      const current = entry.timestamps.length;
      const oldest = entry.timestamps[0];
      const resetMs = Math.max(1, oldest + windowMs - now);
      return {
        allowed: true,
        current,
        limit,
        remaining: Math.max(0, limit - current),
        resetMs,
        retryAfterSeconds: Math.max(1, Math.ceil(resetMs / 1000)),
      };
    }

    // Limit exceeded: do not add current timestamp
    const current = entry.timestamps.length;
    const oldest = entry.timestamps[0] || now;
    const resetMs = Math.max(1, oldest + windowMs - now);
    return {
      allowed: false,
      current,
      limit,
      remaining: 0,
      resetMs,
      retryAfterSeconds: Math.max(1, Math.ceil(resetMs / 1000)),
    };
  }

  /**
   * Inspect current rate limit status without consuming a permit.
   */
  async get(type, key, limit, windowMs) {
    const fullKey = this.#toFullKey(type, key);
    const now = this.clock.now();
    const entry = this.entries.get(fullKey);

    if (!entry) {
      return {
        allowed: true,
        current: 0,
        limit,
        remaining: limit,
        resetMs: windowMs,
        retryAfterSeconds: Math.max(1, Math.ceil(windowMs / 1000)),
      };
    }

    const windowStart = now - windowMs;
    const validTimestamps = entry.timestamps.filter((ts) => ts > windowStart);

    if (validTimestamps.length >= limit) {
      const oldest = validTimestamps[0] || now;
      const resetMs = Math.max(1, oldest + windowMs - now);
      return {
        allowed: false,
        current: validTimestamps.length,
        limit,
        remaining: 0,
        resetMs,
        retryAfterSeconds: Math.max(1, Math.ceil(resetMs / 1000)),
      };
    }

    const current = validTimestamps.length;
    const oldest = validTimestamps.length > 0 ? validTimestamps[0] : now;
    const resetMs = Math.max(1, oldest + windowMs - now);
    return {
      allowed: true,
      current,
      limit,
      remaining: Math.max(0, limit - current),
      resetMs,
      retryAfterSeconds: Math.max(1, Math.ceil(resetMs / 1000)),
    };
  }

  /**
   * Reset / clear counters.
   * If type and key provided: clears specific key.
   * If type provided: clears all keys for that type.
   * If neither provided: clears all entries.
   */
  async reset(type, key) {
    if (type && key) {
      this.entries.delete(this.#toFullKey(type, key));
    } else if (type) {
      const prefix = `${type}:`;
      for (const k of this.entries.keys()) {
        if (k.startsWith(prefix)) {
          this.entries.delete(k);
        }
      }
    } else {
      this.entries.clear();
    }
  }

  /**
   * Prune expired entries to prevent unbounded memory growth.
   * Active entries where now <= entry.expiresAt are NOT deleted.
   */
  cleanup() {
    const now = this.clock.now();
    for (const [key, entry] of this.entries.entries()) {
      if (now > entry.expiresAt) {
        this.entries.delete(key);
      }
    }
  }

  /**
   * Stop cleanup timer and clear all memory.
   */
  destroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.entries.clear();
  }
}

/**
 * Singleton in-memory rate limit store used across the application.
 */
export const defaultRateLimitStore = new MemoryRateLimitStore();

export default {
  RateLimitStore,
  MemoryRateLimitStore,
  defaultRateLimitStore,
};
