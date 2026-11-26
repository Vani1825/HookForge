/**
 * Distributed Redis-backed Sliding-Window Rate Limit Store.
 *
 * Implements atomic distributed rate limiting using Redis sorted sets (ZSET)
 * and Lua scripts to prevent race conditions across multiple application instances.
 * Transparently falls back to MemoryRateLimitStore if Redis is unavailable or unconfigured,
 * ensuring high availability and zero dropped requests.
 */

import { RateLimitStore, MemoryRateLimitStore } from './rateLimitStore.js';
import { getRedisClient } from '../../config/redis.js';
import clock from '../../utils/clock.js';
import logger from '../../utils/logger.js';

const CONSUME_LUA_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local clearBefore = now - windowMs

-- 1. Remove entries outside the sliding window
redis.call('ZREMRANGEBYSCORE', key, 0, clearBefore)

-- 2. Count active entries
local current = redis.call('ZCARD', key)

if current < limit then
  -- 3. Add permit with score = now and unique member
  local seq = redis.call('INCR', key .. ':seq')
  local member = tostring(now) .. ':' .. tostring(seq)
  redis.call('ZADD', key, now, member)
  redis.call('PEXPIRE', key, math.max(windowMs * 2, 10000))
  redis.call('PEXPIRE', key .. ':seq', math.max(windowMs * 2, 10000))

  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local oldestScore = (#oldest > 1) and tonumber(oldest[2]) or now
  local resetMs = math.max(1, (oldestScore + windowMs) - now)
  return { 1, current + 1, limit - (current + 1), resetMs }
else
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local oldestScore = (#oldest > 1) and tonumber(oldest[2]) or now
  local resetMs = math.max(1, (oldestScore + windowMs) - now)
  return { 0, current, 0, resetMs }
end
`;

const GET_LUA_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local clearBefore = now - windowMs

redis.call('ZREMRANGEBYSCORE', key, 0, clearBefore)
local current = redis.call('ZCARD', key)

local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local oldestScore = (#oldest > 1) and tonumber(oldest[2]) or now
local resetMs = math.max(1, (oldestScore + windowMs) - now)

if current < limit then
  return { 1, current, limit - current, resetMs }
else
  return { 0, current, 0, resetMs }
end
`;

export class RedisRateLimitStore extends RateLimitStore {
  /**
   * @param {Object} [options]
   * @param {Object} [options.redisClient] - Redis client or getter function
   * @param {MemoryRateLimitStore} [options.fallbackStore] - In-memory fallback
   * @param {Object} [options.clock] - Clock instance
   * @param {string} [options.prefix] - Key namespace
   */
  constructor(options = {}) {
    super();
    this.clientProvider = options.redisClient || getRedisClient;
    this.fallbackStore = options.fallbackStore || new MemoryRateLimitStore({ clock: options.clock });
    this.clock = options.clock || clock.system;
    this.prefix = options.prefix || 'ratelimit:';
  }

  #getClient() {
    if (typeof this.clientProvider === 'function') {
      return this.clientProvider();
    }
    return this.clientProvider;
  }

  #toKey(type, key) {
    return `${this.prefix}${type}:${key}`;
  }

  /**
   * Consume a permit atomically via Redis Lua script.
   * Falls back to in-memory store if Redis is unavailable.
   */
  async consume(type, key, limit, windowMs) {
    const client = this.#getClient();
    if (!client) {
      return this.fallbackStore.consume(type, key, limit, windowMs);
    }

    const redisKey = this.#toKey(type, key);
    const now = this.clock.now();

    try {
      let result;
      if (typeof client.eval === 'function') {
        result = await client.eval(CONSUME_LUA_SCRIPT, 1, redisKey, now, windowMs, limit);
      } else {
        // Fallback if client doesn't support eval
        return this.fallbackStore.consume(type, key, limit, windowMs);
      }

      const [allowedNum, current, remaining, resetMs] = result;
      const allowed = allowedNum === 1;

      return {
        allowed,
        current: Number(current),
        limit,
        remaining: Number(remaining),
        resetMs: Number(resetMs),
        retryAfterSeconds: Math.max(1, Math.ceil(Number(resetMs) / 1000)),
      };
    } catch (err) {
      logger.warn('Redis rate limit consume failed; falling back to in-memory store', {
        type,
        key,
        error: err?.message,
      });
      return this.fallbackStore.consume(type, key, limit, windowMs);
    }
  }

  /**
   * Inspect current rate limit without consuming.
   */
  async get(type, key, limit, windowMs) {
    const client = this.#getClient();
    if (!client) {
      return this.fallbackStore.get(type, key, limit, windowMs);
    }

    const redisKey = this.#toKey(type, key);
    const now = this.clock.now();

    try {
      let result;
      if (typeof client.eval === 'function') {
        result = await client.eval(GET_LUA_SCRIPT, 1, redisKey, now, windowMs, limit);
      } else {
        return this.fallbackStore.get(type, key, limit, windowMs);
      }

      const [allowedNum, current, remaining, resetMs] = result;
      const allowed = allowedNum === 1;

      return {
        allowed,
        current: Number(current),
        limit,
        remaining: Number(remaining),
        resetMs: Number(resetMs),
        retryAfterSeconds: Math.max(1, Math.ceil(Number(resetMs) / 1000)),
      };
    } catch (err) {
      logger.warn('Redis rate limit get failed; falling back to in-memory store', {
        type,
        key,
        error: err?.message,
      });
      return this.fallbackStore.get(type, key, limit, windowMs);
    }
  }

  /**
   * Reset rate limit keys.
   */
  async reset(type, key) {
    const client = this.#getClient();
    // Always reset fallback store as well
    await this.fallbackStore.reset(type, key);

    if (!client) return;

    try {
      if (type && key) {
        const fullKey = this.#toKey(type, key);
        await client.del(fullKey, `${fullKey}:seq`);
      } else {
        const pattern = type ? `${this.prefix}${type}:*` : `${this.prefix}*`;
        let cursor = '0';
        do {
          const [nextCursor, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
          cursor = nextCursor;
          if (keys.length > 0) {
            await client.del(...keys);
          }
        } while (cursor !== '0');
      }
    } catch (err) {
      logger.warn('Redis rate limit reset failed', { type, key, error: err?.message });
    }
  }

  /**
   * Prune local fallback memory store.
   */
  cleanup() {
    this.fallbackStore.cleanup();
  }

  /**
   * Stop any timers.
   */
  destroy() {
    if (typeof this.fallbackStore.destroy === 'function') {
      this.fallbackStore.destroy();
    }
  }
}

export default RedisRateLimitStore;
