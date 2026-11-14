/**
 * Tests for configuration loader
 */

import { describe, it, expect } from 'vitest';
import config from '../src/config/index.js';

describe('Configuration', () => {
  it('should have valid server configuration', () => {
    expect(config.port).toBeGreaterThan(0);
    expect(config.port).toBeLessThan(65536);
    expect(config.nodeEnv).toBeDefined();
  });

  it('should have valid database configuration', () => {
    expect(config.database.host).toBeDefined();
    expect(config.database.port).toBeGreaterThan(0);
    expect(config.database.user).toBeDefined();
    expect(config.database.database).toBeDefined();
    expect(config.database.poolMax).toBeGreaterThan(0);
  });

  it('should have valid retry configuration', () => {
    expect(config.retry.maxAttempts).toBeGreaterThanOrEqual(1);
    expect(config.retry.baseDelayMs).toBeGreaterThanOrEqual(0);
    expect(config.retry.maxDelayMs).toBeGreaterThanOrEqual(0);
    expect(config.retry.maxDelayMs).toBeGreaterThanOrEqual(config.retry.baseDelayMs);
  });

  it('should have valid dispatcher configuration', () => {
    expect(config.dispatcher.batchSize).toBeGreaterThanOrEqual(1);
    expect(config.dispatcher.workerConcurrency).toBeGreaterThanOrEqual(1);
    expect(config.dispatcher.pollIntervalMs).toBeGreaterThan(0);
    expect(config.dispatcher.leaseMarginMs).toBeGreaterThan(0);
    expect(config.dispatcher.reaperIntervalMs).toBeGreaterThan(0);
  });

  it('should have valid circuit breaker configuration', () => {
    expect(config.circuit.failureThreshold).toBeGreaterThanOrEqual(1);
    expect(config.circuit.openDurationMs).toBeGreaterThan(0);
  });

  it('should have valid HTTP configuration', () => {
    expect(config.http.connectTimeoutMs).toBeGreaterThan(0);
    expect(Number.isSafeInteger(config.http.connectTimeoutMs)).toBe(true);
    expect(config.http.readTimeoutMs).toBeGreaterThan(0);
    expect(Number.isSafeInteger(config.http.readTimeoutMs)).toBe(true);
    expect(config.http.maxResponseBytes).toBeGreaterThan(0);
    expect(Number.isSafeInteger(config.http.maxResponseBytes)).toBe(true);
  });

  it('should have valid ingest configuration', () => {
    expect(config.ingest.maxPayloadBytes).toBeGreaterThan(0);
    expect(Number.isInteger(config.ingest.maxPayloadBytes)).toBe(true);
    expect(Number.isSafeInteger(config.ingest.maxPayloadBytes)).toBe(true);
  });

  it('should have valid CORS configuration', () => {
    expect(config.cors).toBeDefined();
    expect(Array.isArray(config.cors.allowedOrigins)).toBe(true);
  });

  it('should have valid rate limit configuration', () => {
    expect(config.rateLimit).toBeDefined();

    // authFail
    expect(config.rateLimit.authFail.limit).toBeGreaterThan(0);
    expect(Number.isSafeInteger(config.rateLimit.authFail.limit)).toBe(true);
    expect(config.rateLimit.authFail.windowMs).toBeGreaterThan(0);
    expect(Number.isSafeInteger(config.rateLimit.authFail.windowMs)).toBe(true);

    // tenant
    expect(config.rateLimit.tenant.limit).toBeGreaterThan(0);
    expect(Number.isSafeInteger(config.rateLimit.tenant.limit)).toBe(true);
    expect(config.rateLimit.tenant.windowMs).toBeGreaterThan(0);
    expect(Number.isSafeInteger(config.rateLimit.tenant.windowMs)).toBe(true);

    // health
    expect(config.rateLimit.health.limit).toBeGreaterThan(0);
    expect(Number.isSafeInteger(config.rateLimit.health.limit)).toBe(true);
    expect(config.rateLimit.health.windowMs).toBeGreaterThan(0);
    expect(Number.isSafeInteger(config.rateLimit.health.windowMs)).toBe(true);
  });

  it('should have valid trust proxy configuration', () => {
    expect(config.trustProxy !== undefined).toBe(true);
  });

  it('should have valid auth cache configuration', () => {
    expect(config.authCache).toBeDefined();
    expect(typeof config.authCache.enabled).toBe('boolean');
    expect(config.authCache.ttlMs).toBeGreaterThan(0);
    expect(Number.isSafeInteger(config.authCache.ttlMs)).toBe(true);
    expect(config.authCache.maxEntries).toBeGreaterThan(0);
    expect(Number.isSafeInteger(config.authCache.maxEntries)).toBe(true);
  });
});
