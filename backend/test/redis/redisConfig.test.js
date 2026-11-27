/**
 * Tests for Redis configuration, connection lifecycle, and health probing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  calculateRetryDelay,
  sanitizeRedisOptions,
  initRedis,
  isRedisHealthy,
  closeRedis,
  getRedisClient,
  setRedisClientForTesting,
} from '../../src/config/redis.js';
import config from '../../src/config/index.js';

describe('Redis Configuration & Lifecycle', () => {
  beforeEach(() => {
    setRedisClientForTesting(null);
  });

  afterEach(async () => {
    await closeRedis();
  });

  describe('calculateRetryDelay', () => {
    it('returns exponential backoff delay capped at 3000ms', () => {
      expect(calculateRetryDelay(1)).toBe(150);
      expect(calculateRetryDelay(5)).toBe(750);
      expect(calculateRetryDelay(10)).toBe(1500);
      expect(calculateRetryDelay(30)).toBeNull(); // Exceeds max retries
    });

    it('returns null when retry attempts exceed maximum threshold', () => {
      expect(calculateRetryDelay(11)).toBeNull();
      expect(calculateRetryDelay(100)).toBeNull();
    });
  });

  describe('sanitizeRedisOptions', () => {
    it('redacts password from options', () => {
      const opts = { host: 'redis.internal', port: 6379, password: 'superSecretPassword123' };
      const sanitized = sanitizeRedisOptions(opts);
      expect(sanitized.password).toBe('[REDACTED]');
      expect(sanitized.host).toBe('redis.internal');
    });

    it('redacts credentials from connection url', () => {
      const opts = { url: 'redis://default:myPassword123@redis.prod:6379/0' };
      const sanitized = sanitizeRedisOptions(opts);
      expect(sanitized.url).toContain('[REDACTED]@[REDACTED]');
      expect(sanitized.url).not.toContain('myPassword123');
    });
  });

  describe('isRedisHealthy', () => {
    it('reports disabled when Redis is disabled in config', async () => {
      const originalEnabled = config.redis.enabled;
      config.redis.enabled = false;
      try {
        const health = await isRedisHealthy();
        expect(health.status).toBe('disabled');
      } finally {
        config.redis.enabled = originalEnabled;
      }
    });

    it('reports up with latency when ping succeeds', async () => {
      const originalEnabled = config.redis.enabled;
      config.redis.enabled = true;
      try {
        const mockClient = {
          status: 'ready',
          ping: vi.fn().mockResolvedValue('PONG'),
          quit: vi.fn().mockResolvedValue('OK'),
          disconnect: vi.fn(),
        };
        setRedisClientForTesting(mockClient);

        const health = await isRedisHealthy();
        expect(health.status).toBe('up');
        expect(health.latencyMs).toBeGreaterThanOrEqual(0);
      } finally {
        config.redis.enabled = originalEnabled;
      }
    });

    it('reports down with error when ping fails', async () => {
      const originalEnabled = config.redis.enabled;
      config.redis.enabled = true;
      try {
        const mockClient = {
          status: 'ready',
          ping: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
          quit: vi.fn().mockResolvedValue('OK'),
          disconnect: vi.fn(),
        };
        setRedisClientForTesting(mockClient);

        const health = await isRedisHealthy();
        expect(health.status).toBe('down');
        expect(health.error).toContain('ECONNREFUSED');
      } finally {
        config.redis.enabled = originalEnabled;
      }
    });
  });

  describe('initRedis', () => {
    it('returns false when Redis is disabled', async () => {
      const originalEnabled = config.redis.enabled;
      config.redis.enabled = false;
      try {
        const result = await initRedis();
        expect(result).toBe(false);
      } finally {
        config.redis.enabled = originalEnabled;
      }
    });

    it('connects and returns true when ping succeeds', async () => {
      const originalEnabled = config.redis.enabled;
      config.redis.enabled = true;
      try {
        const mockClient = {
          status: 'wait',
          connect: vi.fn().mockResolvedValue(undefined),
          ping: vi.fn().mockResolvedValue('PONG'),
          quit: vi.fn().mockResolvedValue('OK'),
          disconnect: vi.fn(),
        };
        setRedisClientForTesting(mockClient);

        const result = await initRedis();
        expect(result).toBe(true);
        expect(mockClient.connect).toHaveBeenCalled();
        expect(mockClient.ping).toHaveBeenCalled();
      } finally {
        config.redis.enabled = originalEnabled;
      }
    });

    it('gracefully returns false on connection error without crashing', async () => {
      const originalEnabled = config.redis.enabled;
      config.redis.enabled = true;
      try {
        const mockClient = {
          status: 'wait',
          connect: vi.fn().mockRejectedValue(new Error('Connection timed out')),
          ping: vi.fn(),
          quit: vi.fn().mockResolvedValue('OK'),
          disconnect: vi.fn(),
        };
        setRedisClientForTesting(mockClient);

        const result = await initRedis();
        expect(result).toBe(false);
      } finally {
        config.redis.enabled = originalEnabled;
      }
    });
  });

  describe('closeRedis', () => {
    it('disconnects and clears client on shutdown', async () => {
      const mockClient = {
        status: 'ready',
        quit: vi.fn().mockResolvedValue('OK'),
        disconnect: vi.fn(),
      };
      setRedisClientForTesting(mockClient);

      await closeRedis();
      expect(mockClient.quit).toHaveBeenCalled();
      expect(getRedisClient()).toBeNull();
    });
  });
});
