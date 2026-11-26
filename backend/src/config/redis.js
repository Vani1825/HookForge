/**
 * Redis client connection and lifecycle management.
 * Provides resilient connection handling, exponential reconnect backoff,
 * safe error logging (credentials never leaked), and graceful shutdown.
 */

import Redis from 'ioredis';
import config from './index.js';
import logger from '../utils/logger.js';

let redisClient = null;
let isExplicitlyClosed = false;

/**
 * Build sanitized Redis options without credentials for safe logging.
 *
 * @param {Object} opts
 * @returns {Object}
 */
export function sanitizeRedisOptions(opts = {}) {
  const sanitized = { ...opts };
  if (sanitized.password) {
    sanitized.password = '[REDACTED]';
  }
  if (sanitized.url) {
    sanitized.url = sanitized.url.replace(/:\/\/[^:]+:[^@]+@/, '://[REDACTED]@[REDACTED]');
  }
  return sanitized;
}

/**
 * Custom retry strategy for Redis connection failures.
 * Implements exponential backoff with a cap and maximum retry attempts.
 *
 * @param {number} times - Number of retry attempts so far
 * @returns {number|null} Reconnect delay in ms or null to stop retrying
 */
export function calculateRetryDelay(times) {
  const maxRetries = 10;
  if (times > maxRetries) {
    logger.warn('Redis reconnection stopped: maximum retry attempts exceeded', { attempts: times });
    return null; // Stop reconnecting
  }
  // Exponential backoff capped at 3000ms
  const delay = Math.min(times * 150, 3000);
  return delay;
}

/**
 * Create a new configured ioredis client.
 *
 * @param {Object} [overrides] - Custom options or mock overrides
 * @returns {Redis}
 */
export function createRedisClient(overrides = {}) {
  const redisConfig = config.redis || {};

  const baseOptions = {
    lazyConnect: true,
    enableOfflineQueue: false, // Fail fast rather than queuing unbounded commands when offline
    connectTimeout: redisConfig.connectTimeoutMs || 3000,
    maxRetriesPerRequest: 1, // Don't hang indefinitely on disconnected requests
    retryStrategy: calculateRetryDelay,
    keyPrefix: redisConfig.keyPrefix || 'hookforge:',
    ...overrides,
  };

  if (redisConfig.password && !overrides.password) {
    baseOptions.password = redisConfig.password;
  }
  if (redisConfig.db !== undefined && overrides.db === undefined) {
    baseOptions.db = redisConfig.db;
  }

  let client;
  if (redisConfig.url && !overrides.host) {
    client = new Redis(redisConfig.url, baseOptions);
  } else {
    client = new Redis({
      host: overrides.host || redisConfig.host || 'localhost',
      port: overrides.port || redisConfig.port || 6379,
      ...baseOptions,
    });
  }

  client.on('connect', () => {
    logger.info('Redis connection established');
  });

  client.on('ready', () => {
    logger.info('Redis client ready to receive commands');
  });

  client.on('error', (err) => {
    // Avoid crashing the application; log warning with sanitized error
    const safeMsg = (err?.message || 'Unknown Redis error').replace(/password=[^\s]+/gi, 'password=[REDACTED]');
    logger.warn('Redis connection error', { error: safeMsg });
  });

  client.on('close', () => {
    if (!isExplicitlyClosed) {
      logger.debug('Redis connection closed');
    }
  });

  client.on('reconnecting', (delay) => {
    logger.debug('Redis reconnecting', { delayMs: delay });
  });

  return client;
}

/**
 * Get or create the singleton Redis client instance.
 *
 * @returns {Redis|null}
 */
export function getRedisClient() {
  const redisConfig = config.redis || {};
  if (!redisConfig.enabled) {
    return null;
  }

  if (!redisClient && !isExplicitlyClosed) {
    redisClient = createRedisClient();
  }
  return redisClient;
}

/**
 * Initialize and verify Redis connection safely.
 * Non-blocking: catches failures and logs warnings without halting startup.
 *
 * @returns {Promise<boolean>} True if connected, false otherwise
 */
export async function initRedis() {
  const redisConfig = config.redis || {};
  if (!redisConfig.enabled) {
    logger.info('Redis is disabled by configuration');
    return false;
  }

  try {
    const client = getRedisClient();
    if (!client) return false;

    if (client.status === 'wait') {
      await client.connect();
    }
    const pong = await client.ping();
    logger.info('Redis initialization verified', { ping: pong });
    return true;
  } catch (error) {
    logger.warn('Redis initialization failed; falling back to in-memory mode', {
      error: error.message,
    });
    return false;
  }
}

/**
 * Probe Redis connection health and latency.
 *
 * @returns {Promise<{ status: 'up'|'down'|'disabled', latencyMs?: number, error?: string }>}
 */
export async function isRedisHealthy() {
  const redisConfig = config.redis || {};
  if (!redisConfig.enabled) {
    return { status: 'disabled' };
  }

  const client = getRedisClient();
  if (!client) {
    return { status: 'down', error: 'Redis client not initialized' };
  }

  const start = Date.now();
  try {
    if (client.status === 'wait') {
      await client.connect();
    }
    const res = await Promise.race([
      client.ping(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Redis ping timeout')), 1500)),
    ]);

    const latencyMs = Date.now() - start;
    if (res === 'PONG') {
      return { status: 'up', latencyMs };
    }
    return { status: 'down', latencyMs, error: `Unexpected ping response: ${res}` };
  } catch (err) {
    return {
      status: 'down',
      latencyMs: Date.now() - start,
      error: err?.message || 'Redis health probe failed',
    };
  }
}

/**
 * Cleanly close the Redis connection on application shutdown.
 */
export async function closeRedis() {
  isExplicitlyClosed = true;
  if (redisClient) {
    try {
      if (typeof redisClient.quit === 'function' && (redisClient.status === 'ready' || redisClient.status === 'connecting')) {
        await redisClient.quit();
      } else if (typeof redisClient.disconnect === 'function') {
        redisClient.disconnect();
      }
      logger.info('Redis connection closed cleanly');
    } catch (err) {
      logger.warn('Error during Redis client shutdown', { error: err?.message });
      if (typeof redisClient?.disconnect === 'function') {
        redisClient.disconnect();
      }
    } finally {
      redisClient = null;
    }
  }
}

/**
 * Set custom client instance for tests.
 *
 * @param {Object|null} mockClient
 */
export function setRedisClientForTesting(mockClient) {
  redisClient = mockClient;
  isExplicitlyClosed = false;
}

export default {
  getRedisClient,
  initRedis,
  isRedisHealthy,
  closeRedis,
  createRedisClient,
  calculateRetryDelay,
  sanitizeRedisOptions,
  setRedisClientForTesting,
};
