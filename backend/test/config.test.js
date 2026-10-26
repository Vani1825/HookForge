/**
 * Tests for configuration loader
 */

import { describe, it, expect, beforeEach } from 'vitest';
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
    expect(config.http.readTimeoutMs).toBeGreaterThan(0);
  });

  it('should have valid ingest configuration', () => {
    expect(config.ingest.maxPayloadBytes).toBeGreaterThan(0);
  });
});
